// scripts/lib/http.js
// Helper simples de HTTP com retry, usado por todos os coletores.
// Sem dependências externas (usa fetch nativo do Node 18+).

// IMPORTANTE: usamos um User-Agent de navegador comum, e não algo como "dossie-cidadao-bot/1.0".
// Vários sites .gov.br (incluindo o CDN do TSE) rodam atrás de um WAF que bloqueia com HTTP 403
// qualquer requisição cujo User-Agent contenha "bot" ou pareça automatizada — mesmo para arquivos
// de dados abertos totalmente públicos, sem exigir login. Isso não é usado para burlar nenhuma
// restrição de acesso (os arquivos são públicos e o link é o mesmo divulgado oficialmente pelo
// TSE); é só para não cair num bloqueio genérico de bot que também pegaria, por exemplo, o
// Excel/Power Query que o próprio TSE recomenda usar para abrir esses arquivos.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Faz um GET com retry exponencial simples.
 * @param {string} url
 * @param {object} opts { headers, tentativas }
 */
async function getJSON(url, opts = {}) {
  const tentativas = opts.tentativas ?? 3;
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    ...(opts.headers || {}),
  };

  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ao buscar ${url}`);
      }
      return await resp.json();
    } catch (erro) {
      ultimoErro = erro;
      const espera = 500 * Math.pow(2, i);
      console.warn(`  (tentativa ${i + 1}/${tentativas} falhou para ${url}: ${erro.message}. Aguardando ${espera}ms)`);
      await sleep(espera);
    }
  }
  throw new Error(`Falha definitiva ao buscar ${url}: ${ultimoErro?.message}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { getJSON, sleep, USER_AGENT };
