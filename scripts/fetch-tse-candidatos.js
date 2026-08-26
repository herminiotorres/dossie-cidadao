// scripts/fetch-tse-candidatos.js
//
// Baixa a base OFICIAL e COMPLETA de candidatos das Eleições Gerais de 2026 direto do TSE
// (Portal de Dados Abertos: https://dadosabertos.tse.jus.br/dataset/candidatos-2026) e organiza
// em arquivos pequenos e navegáveis pelo site, em vez de um único JSON gigante.
//
// Fonte oficial (confirmada via busca em 25/08/2026):
//   https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip
//
// IMPORTANTE sobre "eleitos" x "candidatos": as Eleições 2026 acontecem em 4/10 (1º turno) e
// 25/10 (2º turno, se houver). Até lá, esta base contém CANDIDATOS REGISTRADOS, não eleitos.
// O campo DS_SIT_TOT_TURNO (resultado da eleição) só é preenchido pelo TSE depois da apuração —
// rodar este script de novo depois de outubro atualiza automaticamente esse campo.
//
// Também não inclui prefeito/vereador: em 2026 são eleitos apenas presidente, governador,
// senador, deputado federal, deputado estadual e deputado distrital (eleições municipais são
// em anos pares terminados em 0/4/8 — a próxima é 2028).
//
// O ZIP baixado contém um CSV por UF e, normalmente, um CSV consolidado nacional
// (consulta_cand_2026_BRASIL.csv). Os arquivos vêm com:
//   - separador ";"
//   - cada campo entre aspas duplas
//   - codificação ISO-8859-1 (Latin-1), não UTF-8
//
// Em vez de assumir nomes de colunas fixos (o TSE já mudou esse layout entre eleições), o script
// lê o cabeçalho de cada CSV e monta os objetos dinamicamente a partir dele — se o TSE adicionar/
// remover colunas, o script continua funcionando.

const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");
const { USER_AGENT } = require("./lib/http");

const RAIZ = path.join(__dirname, "..");
const OUT_DIR = path.join(RAIZ, "docs/data/tse/candidatos");

const ANO_ELEICAO = 2026;
const URL_ZIP = `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ANO_ELEICAO}.zip`;

// Só nos interessam colunas que fazem sentido mostrar/filtrar no site — o CSV completo do TSE
// tem dezenas de colunas (título de eleitor, e-mail, etc.) que não precisamos publicar.
const COLUNAS_UTEIS = [
  "SQ_CANDIDATO",
  "NR_CANDIDATO",
  "NM_CANDIDATO",
  "NM_URNA_CANDIDATO",
  "NM_SOCIAL_CANDIDATO",
  "SG_UF",
  "DS_CARGO",
  "SG_PARTIDO",
  "NM_PARTIDO",
  "NM_COLIGACAO",
  "DS_COMPOSICAO_COLIGACAO",
  "DS_SITUACAO_CANDIDATURA",
  "DS_DETALHE_SITUACAO_CAND",
  "DS_SIT_TOT_TURNO", // resultado final: só vem preenchido após a eleição (out/2026)
  "DS_GENERO",
  "DS_COR_RACA",
  "DS_GRAU_INSTRUCAO",
  "DS_OCUPACAO",
  "ST_REELEICAO",
];

function slugificar(texto) {
  return (texto || "outro")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Parser simples para o formato do TSE: campos entre aspas, separados por ";".
 *  Não lida com ";" dentro de um campo entre aspas (o TSE não costuma usar isso nesses arquivos,
 *  mas se um dia usar, esta função precisa virar um parser CSV completo). */
function parseLinhaTSE(linha) {
  return linha.split(";").map((v) => v.trim().replace(/^"|"$/g, ""));
}

function baixarArquivo(url) {
  console.log(`Baixando ${url} ...`);
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
  }).then(async (resp) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    console.log(`  ok, ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
    return buffer;
  });
}

function lerCsvTse(caminhoArquivo) {
  // Node lê o arquivo como Buffer e decodifica como latin1 nativamente (sem precisar de libs
  // extras de encoding) — os CSVs do TSE não vêm em UTF-8.
  const conteudo = fs.readFileSync(caminhoArquivo).toString("latin1");
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return [];

  const cabecalho = parseLinhaTSE(linhas[0]);
  const registros = [];
  for (let i = 1; i < linhas.length; i++) {
    const valores = parseLinhaTSE(linhas[i]);
    const registro = {};
    cabecalho.forEach((coluna, idx) => {
      registro[coluna] = valores[idx] ?? "";
    });
    registros.push(registro);
  }
  return registros;
}

function reduzirRegistro(registro) {
  const reduzido = {};
  for (const coluna of COLUNAS_UTEIS) {
    if (coluna in registro) reduzido[coluna] = registro[coluna];
  }
  return reduzido;
}

async function main() {
  const dirTemporario = fs.mkdtempSync(path.join(os.tmpdir(), "tse-candidatos-"));
  const caminhoZip = path.join(dirTemporario, "consulta_cand.zip");

  let bufferZip;
  try {
    bufferZip = await baixarArquivo(URL_ZIP);
  } catch (erro) {
    console.error(`ERRO FATAL: não foi possível baixar a base de candidatos do TSE: ${erro.message}`);
    console.error("Verifique se a URL mudou em https://dadosabertos.tse.jus.br/dataset/candidatos-2026");
    process.exit(1);
  }
  fs.writeFileSync(caminhoZip, bufferZip);

  console.log("Descompactando...");
  const zip = new AdmZip(caminhoZip);
  zip.extractAllTo(dirTemporario, true);

  const arquivosCsv = fs
    .readdirSync(dirTemporario)
    .filter((f) => f.toLowerCase().endsWith(".csv"));

  if (arquivosCsv.length === 0) {
    console.error("ERRO: nenhum .csv encontrado dentro do ZIP baixado. O formato do pacote do TSE pode ter mudado.");
    process.exit(1);
  }

  // Prioriza o arquivo consolidado nacional, se existir; senão, processa todos os CSVs (um por UF).
  const arquivoNacional = arquivosCsv.find((f) => /brasil/i.test(f));
  const arquivosParaLer = arquivoNacional ? [arquivoNacional] : arquivosCsv;
  console.log(`Lendo: ${arquivosParaLer.join(", ")}`);

  let todosRegistros = [];
  let cabecalhoCompleto = null;
  for (const arquivo of arquivosParaLer) {
    const registros = lerCsvTse(path.join(dirTemporario, arquivo));
    if (!cabecalhoCompleto && registros.length > 0) cabecalhoCompleto = Object.keys(registros[0]);
    console.log(`  ${arquivo}: ${registros.length} linhas`);
    todosRegistros = todosRegistros.concat(registros);
  }

  console.log(`Total de candidaturas lidas: ${todosRegistros.length}`);

  // Organiza em docs/data/tse/candidatos/<UF>/<cargo-slug>.json — assim o site só carrega o
  // arquivo do filtro que a pessoa escolheu, nunca a base inteira de uma vez.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Debug/transparência: publica TODAS as colunas que o CSV real do TSE trouxe desta vez (feito
  // DEPOIS do rm -rf acima, já que ele apaga a pasta inteira antes de recriá-la).
  if (cabecalhoCompleto) {
    fs.writeFileSync(
      path.join(OUT_DIR, "_colunas_disponiveis.json"),
      JSON.stringify({ gerado_em: new Date().toISOString(), colunas: cabecalhoCompleto }, null, 2)
    );
  }

  const indice = {}; // { uf: { cargoSlug: { nome, total } } }
  const porArquivo = new Map(); // "uf/cargoSlug" -> registros[]

  for (const registro of todosRegistros) {
    const uf = registro.SG_UF || "BR";
    const cargo = registro.DS_CARGO || "OUTRO";
    const cargoSlug = slugificar(cargo);
    const chave = `${uf}/${cargoSlug}`;

    if (!porArquivo.has(chave)) porArquivo.set(chave, []);
    porArquivo.get(chave).push(reduzirRegistro(registro));

    indice[uf] = indice[uf] || {};
    indice[uf][cargoSlug] = indice[uf][cargoSlug] || { nome: cargo, total: 0 };
    indice[uf][cargoSlug].total++;
  }

  for (const [chave, registros] of porArquivo.entries()) {
    const [uf, cargoSlug] = chave.split("/");
    const dirUf = path.join(OUT_DIR, uf);
    fs.mkdirSync(dirUf, { recursive: true });
    // Ordena por nome de urna para a lista já sair alfabética no site.
    registros.sort((a, b) => (a.NM_URNA_CANDIDATO || "").localeCompare(b.NM_URNA_CANDIDATO || ""));
    fs.writeFileSync(path.join(dirUf, `${cargoSlug}.json`), JSON.stringify(registros));
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "_indice.json"),
    JSON.stringify(
      {
        ano_eleicao: ANO_ELEICAO,
        gerado_em: new Date().toISOString(),
        fonte: URL_ZIP,
        aviso: "Contém candidaturas registradas, não eleitos — resultado só sai após a apuração de outubro/2026.",
        ufs: indice,
      },
      null,
      2
    )
  );

  fs.rmSync(dirTemporario, { recursive: true, force: true });
  console.log(`\nConcluído: dados publicados em docs/data/tse/candidatos/ (${porArquivo.size} arquivos UF/cargo).`);
}

main().catch((e) => {
  console.error("Erro fatal em fetch-tse-candidatos.js:", e);
  process.exit(1);
});
