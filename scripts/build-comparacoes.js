// scripts/build-comparacoes.js
//
// Este é o script que faz a comparação central do projeto: para cada político, cruza as
// "promessas_campanha" (cadastradas manualmente em config/politicos.json) com as proposições
// de autoria e os votos coletados nos scripts fetch-*.js, usando os TEMAS como chave de
// cruzamento (ver config/temas.json e scripts/lib/tagging.js).
//
// A saída, por político, tem três blocos:
//   - "convergente": temas em que há promessa E há proposições de autoria no mesmo tema
//     (indício de coerência — não é prova de que uma promessa específica "virou" um projeto
//     específico, apenas que o político legislou na área que prometeu atuar).
//   - "sem_atuacao_encontrada": temas prometidos em que NÃO encontramos proposições de autoria.
//   - "atuacao_fora_das_promessas": proposições de autoria em temas que não constavam nas
//     promessas de campanha (nem sempre é algo negativo — pode ser resposta a um problema novo).
//
// DECISÃO DE DESIGN IMPORTANTE: este cruzamento é por TEMA, não por texto individual. Comparar
// automaticamente "a promessa X foi cumprida pelo projeto Y" exigiria interpretação de
// linguagem natural que uma IA erraria com frequência e de forma difícil de auditar — e como
// isso envolve reputação de pessoas reais, preferimos uma metodologia mais simples, porém
// 100% auditável e explicável linha a linha. Ver docs/metodologia.html.

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const politicosConfig = require(path.join(RAIZ, "config/politicos.json"));
const temasConfig = require(path.join(RAIZ, "config/temas.json"));
const OUT_DIR = path.join(RAIZ, "docs/data/comparacoes");

function carregarDadosColetados(politico) {
  const caminhosPossiveis = [
    path.join(RAIZ, "docs/data/camara", `${politico.id_interno}.json`),
    path.join(RAIZ, "docs/data/senado", `${politico.id_interno}.json`),
    path.join(RAIZ, "docs/data/estadual", `${politico.id_interno}.json`),
    path.join(RAIZ, "docs/data/municipal", `${politico.id_interno}.json`),
    path.join(RAIZ, "docs/data/executivo", `${politico.id_interno}.json`),
  ];
  for (const caminho of caminhosPossiveis) {
    if (fs.existsSync(caminho)) {
      return JSON.parse(fs.readFileSync(caminho, "utf-8"));
    }
  }
  return null;
}

function compararPolitico(politico) {
  const dados = carregarDadosColetados(politico);
  const promessas = politico.promessas_campanha || [];

  if (!dados) {
    return {
      id_interno: politico.id_interno,
      nome: politico.nome,
      status: "sem_dados_coletados",
      mensagem: "Rode o script de coleta correspondente (fetch-camara.js, fetch-senado.js, fetch-sapl.js ou fetch-tse-propostas.js) antes de gerar comparações para este político.",
    };
  }

  const temasPromtidos = new Set();
  for (const p of promessas) for (const t of p.temas || []) temasPromtidos.add(t);

  const proposicoes = dados.proposicoes_autoria || [];
  const temasComAtuacao = new Set();
  for (const prop of proposicoes) for (const t of prop.temas || []) temasComAtuacao.add(t);

  const convergente = [...temasPromtidos].filter((t) => temasComAtuacao.has(t));
  const semAtuacaoEncontrada = [...temasPromtidos].filter((t) => !temasComAtuacao.has(t));
  const atuacaoForaDasPromessas = [...temasComAtuacao].filter((t) => !temasPromtidos.has(t));

  // Estatística simples de votos (quando aplicável — deputados e senadores).
  const votos = dados.votos || [];
  const resumoVotos = {
    total_votos_registrados: votos.length,
    // Nota: para transformar isso em "a favor/contra de tal pauta" de forma confiável seria
    // necessário also cruzar o objeto de cada votação com seu tema, o que exige o campo
    // "temas" preenchido na votação — deixado como próximo passo (ver README, seção Roadmap).
  };

  return {
    id_interno: politico.id_interno,
    nome: politico.nome,
    cargo: politico.cargo,
    status: "ok",
    total_promessas: promessas.length,
    total_proposicoes_autoria: proposicoes.length,
    temas: {
      convergente,
      sem_atuacao_encontrada: semAtuacaoEncontrada,
      atuacao_fora_das_promessas: atuacaoForaDasPromessas,
    },
    resumo_votos: resumoVotos,
    metodologia_versao: "1.0-cruzamento-por-tema",
    gerado_em: new Date().toISOString(),
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const resultado = politicosConfig.politicos.map(compararPolitico);
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(resultado, null, 2));

  for (const r of resultado) {
    fs.writeFileSync(path.join(OUT_DIR, `${r.id_interno}.json`), JSON.stringify(r, null, 2));
  }

  // Publica também a lista de políticos (nomes, cargos, promessas) para o front-end estático
  // conseguir montar os cartões sem precisar ler config/ (que não é servido pelo GitHub Pages).
  fs.writeFileSync(
    path.join(RAIZ, "docs/data/politicos.json"),
    JSON.stringify(politicosConfig.politicos, null, 2)
  );

  // Publica o dicionário de temas também, para o front-end traduzir os ids em nomes legíveis.
  fs.writeFileSync(path.join(RAIZ, "docs/data/temas.json"), JSON.stringify(temasConfig, null, 2));

  // Marca de "última atualização" lida pela página inicial.
  fs.mkdirSync(path.join(RAIZ, "docs/data/meta"), { recursive: true });
  fs.writeFileSync(
    path.join(RAIZ, "docs/data/meta/ultima-atualizacao.json"),
    JSON.stringify({ data: new Date().toISOString() }, null, 2)
  );

  console.log(`Comparações geradas para ${resultado.length} político(s) em docs/data/comparacoes/.`);
  console.log("docs/data/politicos.json, docs/data/temas.json e docs/data/meta/ultima-atualizacao.json atualizados.");
}

main();
