// scripts/fetch-senado.js
//
// Coleta, para cada senador cadastrado em config/politicos.json:
//   1. Dados básicos do perfil        -> /senador/{codigo}.json
//   2. Matérias de autoria            -> /senador/{codigo}/autorias.json
//   3. Votações do senador            -> /senador/{codigo}/votacoes.json
//
// Documentação oficial: https://legis.senado.leg.br/dadosabertos/docs/index.html
// (serviços SenadorService / ListaSenadorService / MateriaService)
//
// Saída: docs/data/senado/<id>.json (um arquivo por senador) + docs/data/senado/_resumo.json

const fs = require("fs");
const path = require("path");
const { getJSON } = require("./lib/http");
const { classificarTexto } = require("./lib/tagging");

const RAIZ = path.join(__dirname, "..");
const politicosConfig = require(path.join(RAIZ, "config/politicos.json"));
const OUT_DIR = path.join(RAIZ, "docs/data/senado");

const API_BASE = "https://legis.senado.leg.br/dadosabertos";

// A API do Senado responde em XML por padrão; usamos o sufixo ".json" nos endpoints
// (documentado oficialmente) para forçar a resposta em JSON.

async function coletarSenador(politico) {
  console.log(`\n=> Senador(a): ${politico.nome} (código ${politico.id_senado})`);
  const codigo = politico.id_senado;

  const perfil = await getJSON(`${API_BASE}/senador/${codigo}.json`).catch((e) => {
    console.warn(`  aviso: falhou ao buscar perfil: ${e.message}`);
    return null;
  });

  const autorias = await getJSON(`${API_BASE}/senador/${codigo}/autorias.json`).catch((e) => {
    console.warn(`  aviso: falhou ao buscar autorias: ${e.message}`);
    return null;
  });

  const votacoes = await getJSON(`${API_BASE}/senador/${codigo}/votacoes.json`).catch((e) => {
    console.warn(`  aviso: falhou ao buscar votações: ${e.message}`);
    return null;
  });

  // A estrutura de resposta do Senado é aninhada e pode variar; navegamos com cuidado
  // e guardamos o objeto original completo também, para nunca perder informação.
  const listaMaterias = extrairLista(autorias, ["MateriasAutoriaParlamentar", "Parlamentar", "Autorias", "Autoria"]);
  const proposicoes = listaMaterias.map((m) => {
    const ementa = m?.Materia?.EmentaMateria || m?.EmentaMateria || m?.ementa || "";
    const temas = classificarTexto(ementa);
    return {
      identificacao: m?.Materia?.IdentificacaoMateria || m?.IdentificacaoMateria || null,
      ementa,
      temas: temas.map((t) => t.id),
      bruto: m,
    };
  });

  const listaVotos = extrairLista(votacoes, ["VotacaoParlamentar", "Parlamentar", "Votacoes", "Votacao"]);

  return {
    id_interno: politico.id_interno,
    nome: politico.nome,
    cargo: politico.cargo,
    uf: politico.uf,
    partido: politico.partido,
    perfil,
    proposicoes_autoria: proposicoes,
    votos: listaVotos,
    atualizado_em: new Date().toISOString(),
  };
}

/**
 * A API do Senado costuma envolver listas em várias camadas de objetos (ex.:
 * { AutoriaParlamentar: { Parlamentar: { Autorias: { Autoria: [...] } } } }).
 * Esta função tenta descer por uma sequência de chaves candidatas até achar um array.
 * Se algo mudar na API, isso é logado claramente em vez de quebrar o script inteiro.
 */
function extrairLista(objeto, chavesCandidatas) {
  let atual = objeto;
  for (const chave of chavesCandidatas) {
    if (!atual) return [];
    if (Array.isArray(atual)) return atual;
    atual = atual[chave] ?? atual[Object.keys(atual)[0]]?.[chave];
  }
  if (Array.isArray(atual)) return atual;
  if (atual) return [atual]; // item único, não veio como lista
  return [];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const senadores = politicosConfig.politicos.filter((p) => p.casa === "senado" && p.id_senado);
  if (senadores.length === 0) {
    console.log("Nenhum senador configurado em config/politicos.json (casa: 'senado'). Nada a fazer.");
    return;
  }

  const resumo = [];
  for (const politico of senadores) {
    try {
      const dados = await coletarSenador(politico);
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
      console.log(`  ok: ${dados.proposicoes_autoria.length} matérias, ${dados.votos.length} votações registradas.`);
    } catch (erro) {
      console.error(`  ERRO ao coletar ${politico.nome}: ${erro.message}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "_resumo.json"), JSON.stringify(resumo, null, 2));
  console.log("\nSenado: coleta finalizada.");
}

main().catch((e) => {
  console.error("Erro fatal em fetch-senado.js:", e);
  process.exit(1);
});
