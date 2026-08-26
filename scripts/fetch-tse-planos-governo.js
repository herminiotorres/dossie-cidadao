// scripts/fetch-tse-planos-governo.js
//
// Baixa os pacotes oficiais de "Proposta de Governo" do TSE (os planos de governo em PDF que
// candidatos a cargo EXECUTIVO — presidente e governador, em 2026 — são obrigados a registrar)
// e liga cada arquivo ao político correspondente cadastrado em config/politicos.json.
//
// Fontes oficiais (confirmadas via busca em 25/08/2026), uma por UF, mais "BR" para presidente:
//   https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2026_BR.zip
//   https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2026_<UF>.zip
//
// COMO A CORRESPONDÊNCIA FUNCIONA (atualizado depois de inspecionar um pacote real e o CSV real
// de candidatos — ver histórico do projeto para o caminho até aqui):
// Os PDFs vêm nomeados como "<ANO><UF><NUMERO>_01.pdf" (ex.: "2026CE60002531351_01.pdf"). A
// coluna "NR_PROTOCOLO_CANDIDATURA" NÃO existe no CSV consolidado do TSE (confirmado inspecionando
// o cabeçalho real em 26/08/2026) — o número no nome do arquivo é, na verdade, o SQ_CANDIDATO,
// que já baixamos e guardamos em docs/data/tse/candidatos/<UF>/<cargo>.json via
// scripts/fetch-tse-candidatos.js. Ou seja: em vez de pedir pra alguém preencher um ID na mão,
// este script:
//   1. Acha o registro do político na base de candidatos JÁ BAIXADA (por nome de urna oficial);
//   2. Pega o SQ_CANDIDATO desse registro;
//   3. Procura, dentro do ZIP de propostas de governo, um arquivo cujo nome contenha esse número.
// Isso é uma correspondência de ALTA confiança porque o SQ_CANDIDATO é único por candidatura e
// vem direto da fonte oficial — não é um palpite por nome parecido.
//
// Se por algum motivo o político não for encontrado na base local (ex.: ainda não rodou
// 'npm run fetch:tse-candidatos', ou o nome de urna está grafado diferente), o script cai para
// uma correspondência de BAIXA confiança por nome no arquivo, sempre marcada como tal — nunca
// afirma certeza que não tem.
//
// Cargos cobertos: apenas Presidente e Governador, porque são os únicos cargos executivos em
// disputa nas Eleições Gerais de 2026 (prefeito é eleito em 2024/2028, não em 2026).

const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");
const { USER_AGENT } = require("./lib/http");

const RAIZ = path.join(__dirname, "..");
const politicosConfig = require(path.join(RAIZ, "config/politicos.json"));
const OUT_DIR_MANIFESTOS = path.join(RAIZ, "docs/data/tse/propostas-governo");
const OUT_DIR_EXECUTIVO = path.join(RAIZ, "docs/data/executivo");
const DIR_CANDIDATOS = path.join(RAIZ, "docs/data/tse/candidatos");

const ANO_ELEICAO = 2026;

function urlZipPropostaGoverno(uf) {
  return `https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_${ANO_ELEICAO}_${uf}.zip`;
}

function normalizar(texto) {
  return (texto || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Descobre qual UF de busca usar no ZIP de propostas de governo (ou "BR" para presidente). */
function ufParaBusca(politico) {
  const cargo = normalizar(politico.cargo);
  if (cargo.includes("presidente")) return "BR";
  if (cargo.includes("governador")) return politico.uf || politico.municipio_ou_uf || null;
  return null; // prefeito e outros cargos não têm esse dataset em 2026 (sem eleição municipal)
}

/** Descobre o "slug" de cargo usado por fetch-tse-candidatos.js para nomear os arquivos em
 *  docs/data/tse/candidatos/<uf>/<cargo-slug>.json. */
function cargoSlugParaBusca(politico) {
  const cargo = normalizar(politico.cargo);
  if (cargo.includes("presidente")) return "presidente";
  if (cargo.includes("governador")) return "governador";
  return null;
}

/** Carrega docs/data/tse/candidatos/<uf>/<cargoSlug>.json (gerado por fetch-tse-candidatos.js)
 *  e acha o registro do político por nome de urna normalizado. */
function buscarCandidatoNaBaseLocal(politico, uf, cargoSlug) {
  const caminho = path.join(DIR_CANDIDATOS, uf, `${cargoSlug}.json`);
  if (!fs.existsSync(caminho)) return null;

  let registros;
  try {
    registros = JSON.parse(fs.readFileSync(caminho, "utf-8"));
  } catch {
    return null;
  }

  const nomeAlvo = normalizar(politico.nome);
  return (
    registros.find((r) => normalizar(r.NM_URNA_CANDIDATO) === nomeAlvo) ||
    registros.find((r) => normalizar(r.NM_CANDIDATO) === nomeAlvo) ||
    // Correspondência parcial como último recurso, só quando o nome é longo o suficiente para
    // não gerar falso positivo (ex.: um nome de 3 letras não bastaria).
    (nomeAlvo.length > 6
      ? registros.find(
          (r) =>
            normalizar(r.NM_URNA_CANDIDATO).includes(nomeAlvo) ||
            nomeAlvo.includes(normalizar(r.NM_URNA_CANDIDATO))
        )
      : null) ||
    null
  );
}

async function baixarEExtrairZip(uf, dirTemporario) {
  const url = urlZipPropostaGoverno(uf);
  console.log(`  baixando ${url} ...`);
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  const caminhoZip = path.join(dirTemporario, `proposta_governo_${uf}.zip`);
  fs.writeFileSync(caminhoZip, buffer);

  const destino = path.join(dirTemporario, uf);
  fs.mkdirSync(destino, { recursive: true });
  new AdmZip(caminhoZip).extractAllTo(destino, true);

  return { destino, url };
}

/** Lista todos os arquivos extraídos recursivamente, com metadados básicos. */
function listarArquivos(dir) {
  const resultado = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminhoCompleto = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArquivos(caminhoCompleto));
    } else {
      resultado.push({ nome: entrada.name, caminho: caminhoCompleto, tamanho: fs.statSync(caminhoCompleto).size });
    }
  }
  return resultado;
}

/** Tenta encontrar, para um político, o arquivo correspondente — com nível de confiança
 *  explícito, nunca uma afirmação silenciosa.
 *
 *  Ordem de tentativas, da mais para a menos confiável:
 *   1. SQ_CANDIDATO achado na base local de candidatos (docs/data/tse/candidatos/...), procurado
 *      no nome do arquivo — ALTA confiança (é a chave real usada nos nomes de arquivo do TSE).
 *   2. id_candidato_tse preenchido manualmente em config/politicos.json, se existir, procurado
 *      no nome do arquivo — MÉDIA confiança (depende de quem preencheu ter copiado certo).
 *   3. Nome do político (normalizado) aparecendo no nome do arquivo — BAIXA confiança (nomes de
 *      arquivo do TSE normalmente não trazem o nome da pessoa, então isso quase nunca deve bater;
 *      se bater, ainda assim pedimos confirmação manual). */
function encontrarCorrespondencia(politico, arquivos, uf) {
  const arquivosReais = arquivos.filter((a) => !/^leiame/i.test(a.nome));

  // 1) SQ_CANDIDATO, via base local de candidatos já baixada.
  const cargoSlug = cargoSlugParaBusca(politico);
  if (cargoSlug) {
    const candidato = buscarCandidatoNaBaseLocal(politico, uf, cargoSlug);
    if (candidato && candidato.SQ_CANDIDATO) {
      const sqCandidato = String(candidato.SQ_CANDIDATO).trim();
      const arquivo = arquivosReais.find((a) => a.nome.includes(sqCandidato));
      if (arquivo) {
        return {
          confianca: "alta",
          metodo: `SQ_CANDIDATO ${sqCandidato} (de docs/data/tse/candidatos/${uf}/${cargoSlug}.json) encontrado no nome do arquivo`,
          arquivo: arquivo.nome,
          sq_candidato: sqCandidato,
        };
      }
      // Achamos o candidato na base local (nome bateu certinho), mas o SQ_CANDIDATO dele não
      // aparece em nenhum arquivo do pacote — ou seja, é bem provável que esse candidato
      // específico não tenha (ainda) protocolado o plano de governo, e não um erro do script.
      console.warn(
        `    diagnóstico: "${politico.nome}" foi encontrado na base local (SQ_CANDIDATO ${sqCandidato}, nome de urna "${candidato.NM_URNA_CANDIDATO}"), mas nenhum arquivo do pacote de ${uf} contém esse número — provavelmente esse candidato ainda não protocolou o plano de governo, ou protocolou fora do prazo capturado neste pacote.`
      );
    } else if (candidato) {
      console.warn(`    diagnóstico: achei "${politico.nome}" na base local, mas o registro não tem SQ_CANDIDATO preenchido (incomum — confira docs/data/tse/candidatos/${uf}/${cargoSlug}.json manualmente).`);
    } else {
      console.warn(
        `    diagnóstico: NÃO achei "${politico.nome}" em docs/data/tse/candidatos/${uf}/${cargoSlug}.json — o nome de urna oficial no TSE pode ser diferente do cadastrado em config/politicos.json. Abra esse arquivo e procure manualmente (ex.: apelidos como "Delegado Hugo" às vezes aparecem só com o nome civil completo).`
      );
    }
  }

  // 2) id_candidato_tse preenchido manualmente (compatibilidade com quem já preencheu à mão).
  const idAlvo = String(politico.id_candidato_tse || "").trim();
  if (idAlvo) {
    const arquivo = arquivosReais.find((a) => a.nome.includes(idAlvo));
    if (arquivo) {
      return { confianca: "media", metodo: "id_candidato_tse (config) encontrado no nome do arquivo", arquivo: arquivo.nome };
    }
  }

  // 3) Nome do político no nome do arquivo — praticamente nunca deve bater neste formato do TSE,
  // mas mantido como rede de segurança para formatos antigos/diferentes.
  const nomeAlvoNormalizado = normalizar(politico.nome);
  const arquivoPorNome = arquivosReais.find(
    (a) => normalizar(a.nome).includes(nomeAlvoNormalizado) && nomeAlvoNormalizado.length > 4
  );
  if (arquivoPorNome) {
    return {
      confianca: "baixa",
      metodo: "nome do político encontrado (normalizado) no nome do arquivo — CONFIRME MANUALMENTE",
      arquivo: arquivoPorNome.nome,
    };
  }

  return { confianca: "nao_encontrado", metodo: null };
}

async function main() {
  fs.mkdirSync(OUT_DIR_MANIFESTOS, { recursive: true });
  fs.mkdirSync(OUT_DIR_EXECUTIVO, { recursive: true });

  const executivos = politicosConfig.politicos.filter((p) => p.casa === "executivo" && ufParaBusca(p));
  if (executivos.length === 0) {
    console.log("Nenhum político executivo (presidente/governador) com UF identificável em config/politicos.json. Nada a fazer.");
    return;
  }

  // Agrupa por UF/BR para não baixar o mesmo pacote duas vezes.
  const ufsNecessarias = [...new Set(executivos.map(ufParaBusca))];
  const dirTemporario = fs.mkdtempSync(path.join(os.tmpdir(), "tse-planos-governo-"));
  const cacheUf = {};

  for (const uf of ufsNecessarias) {
    try {
      const { destino, url } = await baixarEExtrairZip(uf, dirTemporario);
      const arquivos = listarArquivos(destino);
      cacheUf[uf] = { arquivos, url };

      // Publica um manifesto bruto por UF — útil para pesquisa manual mesmo de políticos ainda
      // não cadastrados em config/politicos.json.
      fs.writeFileSync(
        path.join(OUT_DIR_MANIFESTOS, `${uf}.json`),
        JSON.stringify(
          {
            uf,
            fonte: url,
            total_arquivos: arquivos.length,
            arquivos: arquivos.map((a) => ({ nome: a.nome, tamanho_kb: Math.round(a.tamanho / 1024) })),
          },
          null,
          2
        )
      );
      console.log(`  ${uf}: ${arquivos.length} arquivo(s) catalogado(s).`);
    } catch (erro) {
      console.warn(`  aviso: falhou ao processar UF ${uf}: ${erro.message}`);
      cacheUf[uf] = null;
    }
  }

  for (const politico of executivos) {
    const uf = ufParaBusca(politico);
    const dadosUf = cacheUf[uf];

    let resultado;
    if (!dadosUf) {
      resultado = { confianca: "erro", metodo: `não foi possível baixar/processar o pacote da UF ${uf}` };
    } else {
      resultado = encontrarCorrespondencia(politico, dadosUf.arquivos, uf);
    }

    const saida = {
      id_interno: politico.id_interno,
      nome: politico.nome,
      cargo: politico.cargo,
      uf_consultada: uf,
      correspondencia: resultado,
      instrucao:
        resultado.confianca === "alta"
          ? "Correspondência automática de alta confiança (via SQ_CANDIDATO oficial)."
          : "Verifique manualmente antes de exibir este vínculo como certo — consulte o manifesto em docs/data/tse/propostas-governo/ para conferir os arquivos disponíveis dessa UF.",
      atualizado_em: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(OUT_DIR_EXECUTIVO, `${politico.id_interno}-proposta-governo.json`),
      JSON.stringify(saida, null, 2)
    );
    console.log(`  ${politico.nome}: confiança = ${resultado.confianca}`);
  }

  fs.rmSync(dirTemporario, { recursive: true, force: true });
  console.log("\nPlanos de governo (TSE): coleta finalizada.");
}

main().catch((e) => {
  console.error("Erro fatal em fetch-tse-planos-governo.js:", e);
  process.exit(1);
});
