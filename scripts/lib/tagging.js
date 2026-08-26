// scripts/lib/tagging.js
// Classifica um texto (ementa de proposição, texto de promessa) em uma lista de temas
// usando correspondência de palavras-chave. Deliberadamente simples e transparente:
// o objetivo é que qualquer pessoa consiga auditar POR QUE algo foi marcado com tal tema,
// olhando o config/temas.json. Isso é uma escolha de design, não uma limitação técnica —
// comparações políticas automatizadas por "IA opaca" são um risco de viés e de injustiça
// com os políticos avaliados.

const temasConfig = require("../../config/temas.json");

function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove acentos
}

/**
 * @param {string} texto
 * @returns {{id: string, nome: string, ocorrencias: number}[]} temas encontrados, ordenados por relevância
 */
function classificarTexto(texto) {
  const alvo = normalizar(texto);
  const encontrados = [];

  for (const tema of temasConfig.temas) {
    let ocorrencias = 0;
    for (const palavra of tema.palavras_chave) {
      const p = normalizar(palavra);
      if (alvo.includes(p)) ocorrencias++;
    }
    if (ocorrencias > 0) {
      encontrados.push({ id: tema.id, nome: tema.nome, ocorrencias });
    }
  }

  return encontrados.sort((a, b) => b.ocorrencias - a.ocorrencias);
}

module.exports = { classificarTexto, normalizar };
