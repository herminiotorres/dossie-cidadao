// scripts/fetch-camara.js
//
// Coleta, para cada deputado federal cadastrado em config/politicos.json:
//   1. Dados básicos do perfil            -> API REST /deputados/{id}
//   2. Proposições das quais é autor       -> arquivo em massa proposicoesAutores-{ano}.json
//      (documentado em https://dadosabertos.camara.leg.br/swagger/api.html, aba "Arquivos")
//   3. O texto (ementa) de cada proposição -> arquivo em massa proposicoes-{ano}.json
//   4. Como o deputado votou em cada votação nominal -> arquivo em massa votacoesVotos-{ano}.json
//
// Usamos os arquivos em massa (e não filtros da API REST) porque são a forma OFICIALMENTE
// documentada e estável de obter "todas as proposições de um autor" e "todos os votos de um
// deputado" — a API REST não tem um filtro direto e confiável para isso.
//
// Saída: docs/data/camara/<id>.json (um arquivo por deputado) + docs/data/camara/_resumo.json

const fs = require("fs");
const path = require("path");
const { getJSON } = require("./lib/http");
const { classificarTexto } = require("./lib/tagging");

const RAIZ = path.join(__dirname, "..");
const politicosConfig = require(path.join(RAIZ, "config/politicos.json"));
const OUT_DIR = path.join(RAIZ, "docs/data/camara");

const API_BASE = "https://dadosabertos.camara.leg.br/api/v2";
const ARQ_BASE = "https://dadosabertos.camara.leg.br/arquivos";

// Quantos anos de histórico (para trás, a partir do ano atual) vamos varrer nos arquivos em massa.
const ANOS_HISTORICO = 4;

function anosParaVarrer() {
  const anoAtual = new Date().getFullYear();
  const anos = [];
  for (let i = 0; i < ANOS_HISTORICO; i++) anos.push(anoAtual - i);
  return anos;
}

// Cache em memória para não baixar o mesmo arquivo-ano várias vezes (ele é grande e é o mesmo
// para todos os deputados acompanhados).
const cacheArquivosPorAno = {};

async function baixarArquivoAno(nomeArquivo, ano) {
  const chave = `${nomeArquivo}-${ano}`;
  if (cacheArquivosPorAno[chave]) return cacheArquivosPorAno[chave];

  const url = `${ARQ_BASE}/${nomeArquivo}/json/${nomeArquivo}-${ano}.json`;
  console.log(`  baixando ${url} ...`);
  try {
    const dados = await getJSON(url);
    // Os arquivos em massa da Câmara vêm no formato { dados: [...] }
    cacheArquivosPorAno[chave] = dados.dados || dados;
  } catch (erro) {
    console.warn(`  aviso: não foi possível baixar ${nomeArquivo}-${ano}: ${erro.message}`);
    cacheArquivosPorAno[chave] = [];
  }
  return cacheArquivosPorAno[chave];
}

async function coletarDeputado(politico) {
  console.log(`\n=> Deputado: ${politico.nome} (id ${politico.id_camara})`);
  const idAlvo = String(politico.id_camara);

  const perfil = await getJSON(`${API_BASE}/deputados/${politico.id_camara}`).catch((e) => {
    console.warn(`  aviso: falhou ao buscar perfil: ${e.message}`);
    return null;
  });

  const proposicoesDoAno = [];
  const votosDoAno = [];

  for (const ano of anosParaVarrer()) {
    // --- Autoria de proposições ---
    const autores = await baixarArquivoAno("proposicoesAutores", ano);
    const idsProposicoesDoDeputado = autores
      .filter((a) => String(a.idDeputadoAutor ?? a.idAutor ?? "") === idAlvo)
      .map((a) => a.idProposicao);

    if (idsProposicoesDoDeputado.length > 0) {
      const todasProposicoesDoAno = await baixarArquivoAno("proposicoes", ano);
      const mapaProposicoes = new Map(todasProposicoesDoAno.map((p) => [p.id, p]));

      for (const idProp of idsProposicoesDoDeputado) {
        const prop = mapaProposicoes.get(idProp);
        if (!prop) continue;
        const temas = classificarTexto(`${prop.ementa || ""} ${prop.keywords || ""}`);
        proposicoesDoAno.push({
          id: prop.id,
          siglaTipo: prop.siglaTipo,
          numero: prop.numero,
          ano: prop.ano,
          ementa: prop.ementa,
          situacao: prop.descricaoTramitacao || prop.statusProposicao?.descricaoTramitacao || null,
          url: `${API_BASE}/proposicoes/${prop.id}`,
          temas: temas.map((t) => t.id),
        });
      }
    }

    // --- Votos nominais ---
    const votos = await baixarArquivoAno("votacoesVotos", ano);
    const votosDoDeputadoNoAno = votos.filter(
      (v) => String(v.deputado_?.id ?? v.idDeputado ?? "") === idAlvo
    );
    for (const v of votosDoDeputadoNoAno) {
      votosDoAno.push({
        idVotacao: v.idVotacao,
        voto: v.voto ?? v.tipoVoto,
        data: v.dataHoraVoto ?? v.data,
      });
    }
  }

  return {
    id_interno: politico.id_interno,
    nome: politico.nome,
    cargo: politico.cargo,
    uf: politico.uf,
    partido: politico.partido,
    perfil,
    proposicoes_autoria: proposicoesDoAno,
    votos: votosDoAno,
    atualizado_em: new Date().toISOString(),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const deputados = politicosConfig.politicos.filter((p) => p.casa === "camara" && p.id_camara);
  if (deputados.length === 0) {
    console.log("Nenhum deputado configurado em config/politicos.json (casa: 'camara'). Nada a fazer.");
    return;
  }

  const resumo = [];
  for (const politico of deputados) {
    try {
      const dados = await coletarDeputado(politico);
      fs.writeFileSync(
        path.join(OUT_DIR, `${politico.id_interno}.json`),
        JSON.stringify(dados, null, 2)
      );
      resumo.push({
        id_interno: politico.id_interno,
        nome: politico.nome,
        total_proposicoes: dados.proposicoes_autoria.length,
        total_votos: dados.votos.length,
      });
      console.log(`  ok: ${dados.proposicoes_autoria.length} proposições, ${dados.votos.length} votos registrados.`);
    } catch (erro) {
      console.error(`  ERRO ao coletar ${politico.nome}: ${erro.message}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "_resumo.json"), JSON.stringify(resumo, null, 2));
  console.log("\nCâmara: coleta finalizada.");
}

main().catch((e) => {
  console.error("Erro fatal em fetch-camara.js:", e);
  process.exit(1);
});
