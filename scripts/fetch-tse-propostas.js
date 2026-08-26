// scripts/fetch-tse-propostas.js
//
// IMPORTANTE — leia antes de usar:
// O TSE não expõe uma API REST simples de "proposta de governo por candidato". Os dados
// abertos do TSE (https://dadosabertos.tse.jus.br) são publicados como pacotes CSV grandes por
// eleição/ano (ex.: "Candidatos" traz um CSV nacional com centenas de milhares de linhas), e o
// arquivo do Plano de Governo em si é um PDF anexado ao registro de candidatura, sem texto
// estruturado.
//
// Por isso este script faz duas coisas bem mais modestas e honestas sobre o que é automatizável:
//   1. Baixa o pacote de candidatos do ano informado e localiza a linha do candidato pelo
//      SQ_CANDIDATO configurado em config/politicos.json — confirmando dados básicos oficiais
//      (nome de urna, partido, situação) e a URL do Plano de Governo, quando existir.
//   2. NÃO tenta extrair automaticamente as promessas do PDF. Isso fica para preenchimento
//      manual em config/politicos.json (campo "promessas_campanha"), como já é feito para os
//      demais políticos. Extração automática de PDF por OCR/NLP é possível, mas tem alto risco
//      de erro de leitura — preferimos que uma pessoa confira a fonte primária.
//
// Executivos (prefeito, governador, presidente) também não têm "votos" no sentido legislativo.
// A comparação para esse grupo, feita em scripts/build-comparacoes.js, usa o texto de decretos/
// sanções cadastrados manualmente em config/politicos.json (campo "atos_executivos", opcional)
// em vez de "votos a favor/contra". Ver docs/metodologia.html.

const fs = require("fs");
const path = require("path");
const { getJSON } = require("./lib/http");

const RAIZ = path.join(__dirname, "..");
const politicosConfig = require(path.join(RAIZ, "config/politicos.json"));
const OUT_DIR = path.join(RAIZ, "docs/data/executivo");

// Pacote de dados abertos do TSE com o índice de candidatos (formato varia por ano de eleição).
// Confira a URL atual em https://dadosabertos.tse.jus.br/dataset/candidatos-{ano} antes de usar,
// pois o TSE reorganiza esses pacotes entre eleições.
function urlCandidatosTSE(ano) {
  return `https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-${ano}`;
}

async function coletarExecutivo(politico) {
  console.log(`\n=> ${politico.cargo}: ${politico.nome}`);

  if (!politico.id_candidato_tse) {
    console.log("  aviso: sem 'id_candidato_tse' configurado — pulando busca automática, use só as promessas manuais.");
    return {
      id_interno: politico.id_interno,
      nome: politico.nome,
      cargo: politico.cargo,
      dados_tse: null,
      observacao: "Dados do TSE não coletados automaticamente (falta id_candidato_tse ou pacote não localizado). Preencha 'promessas_campanha' manualmente em config/politicos.json.",
      promessas_campanha: politico.promessas_campanha || [],
      atos_executivos: politico.atos_executivos || [],
      atualizado_em: new Date().toISOString(),
    };
  }

  // Este bloco é intencionalmente conservador: se o formato do pacote do TSE mudou (o que é
  // comum), o script avisa e segue em frente em vez de travar toda a coleta dos outros políticos.
  let metaPacote = null;
  try {
    metaPacote = await getJSON(urlCandidatosTSE(politico.ano_eleicao_tse || new Date().getFullYear()));
  } catch (e) {
    console.warn(`  aviso: não foi possível consultar o catálogo de dados abertos do TSE: ${e.message}`);
  }

  return {
    id_interno: politico.id_interno,
    nome: politico.nome,
    cargo: politico.cargo,
    dados_tse_pacote: metaPacote?.result?.name || null,
    promessas_campanha: politico.promessas_campanha || [],
    atos_executivos: politico.atos_executivos || [],
    atualizado_em: new Date().toISOString(),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const executivos = politicosConfig.politicos.filter((p) => p.casa === "executivo");
  if (executivos.length === 0) {
    console.log("Nenhum político com casa: 'executivo' configurado. Nada a fazer.");
    return;
  }

  for (const politico of executivos) {
    try {
      const dados = await coletarExecutivo(politico);
      fs.writeFileSync(path.join(OUT_DIR, `${politico.id_interno}.json`), JSON.stringify(dados, null, 2));
      console.log("  ok.");
    } catch (erro) {
      console.error(`  ERRO ao coletar ${politico.nome}: ${erro.message}`);
    }
  }

  console.log("\nExecutivo (TSE): coleta finalizada.");
}

main().catch((e) => {
  console.error("Erro fatal em fetch-tse-propostas.js:", e);
  process.exit(1);
});
