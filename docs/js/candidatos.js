// docs/js/candidatos.js
// Carrega o índice de candidatos do TSE (docs/data/tse/candidatos/_indice.json) e, sob demanda,
// o arquivo específico de UF+cargo escolhido pela pessoa — nunca a base inteira de uma vez,
// porque ela tem dezenas de milhares de candidaturas.

const LIMITE_LINHAS_RENDERIZADAS = 500;

async function carregarJSON(caminho) {
  try {
    const resp = await fetch(caminho, { cache: "no-cache" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function rotuloUf(uf) {
  return uf === "BR" ? "BR (nacional — Presidente)" : uf;
}

let indiceAtual = null;
let registrosCarregados = [];

function popularSelectUf(indice) {
  const select = document.getElementById("filtro-uf");
  const ufsOrdenadas = Object.keys(indice.ufs).sort((a, b) => (a === "BR" ? -1 : a.localeCompare(b)));
  select.innerHTML = ufsOrdenadas.map((uf) => `<option value="${uf}">${rotuloUf(uf)}</option>`).join("");
}

function popularSelectCargo(indice, uf) {
  const select = document.getElementById("filtro-cargo");
  const cargos = indice.ufs[uf] || {};
  const entradas = Object.entries(cargos).sort((a, b) => b[1].total - a[1].total);
  select.innerHTML = entradas
    .map(([slug, info]) => `<option value="${slug}">${info.nome} (${info.total})</option>`)
    .join("");
}

function renderizarTabela(registros, termoBusca) {
  const corpo = document.getElementById("corpo-tabela");
  const contador = document.getElementById("contador-resultados");
  const avisoPaginacao = document.getElementById("aviso-paginacao");

  const termo = (termoBusca || "").toLowerCase().trim();
  const filtrados = termo
    ? registros.filter((r) => {
        const alvo = `${r.NM_URNA_CANDIDATO || ""} ${r.NM_CANDIDATO || ""} ${r.SG_PARTIDO || ""} ${r.NM_PARTIDO || ""}`.toLowerCase();
        return alvo.includes(termo);
      })
    : registros;

  contador.textContent = `${filtrados.length} candidatura(s) encontrada(s)${termo ? ` para "${termoBusca}"` : ""}.`;

  const paraRenderizar = filtrados.slice(0, LIMITE_LINHAS_RENDERIZADAS);
  corpo.innerHTML = paraRenderizar
    .map((r) => {
      const situacao = r.DS_SITUACAO_CANDIDATURA || "—";
      const resultado = r.DS_SIT_TOT_TURNO && r.DS_SIT_TOT_TURNO !== "#NULO#" ? r.DS_SIT_TOT_TURNO : "aguardando eleição";
      return `
        <tr>
          <td class="font-medium">${r.NM_URNA_CANDIDATO || r.NM_CANDIDATO || "—"}</td>
          <td class="font-data">${r.NR_CANDIDATO || "—"}</td>
          <td>${r.SG_PARTIDO || "—"}</td>
          <td><span class="etiqueta-situacao">${situacao}</span></td>
          <td>${resultado}</td>
        </tr>
      `;
    })
    .join("");

  avisoPaginacao.textContent =
    filtrados.length > LIMITE_LINHAS_RENDERIZADAS
      ? `Mostrando as primeiras ${LIMITE_LINHAS_RENDERIZADAS} de ${filtrados.length} — refine a busca para ver outras.`
      : "";
}

async function carregarESRenderizar() {
  const uf = document.getElementById("filtro-uf").value;
  const cargo = document.getElementById("filtro-cargo").value;
  if (!uf || !cargo) return;

  document.getElementById("contador-resultados").textContent = "carregando…";
  const registros = await carregarJSON(`data/tse/candidatos/${uf}/${cargo}.json`);
  registrosCarregados = registros || [];
  renderizarTabela(registrosCarregados, document.getElementById("filtro-busca").value);
}

async function iniciar() {
  const avisoStatus = document.getElementById("aviso-status");
  indiceAtual = await carregarJSON("data/tse/candidatos/_indice.json");

  if (!indiceAtual || Object.keys(indiceAtual.ufs || {}).length === 0) {
    avisoStatus.textContent =
      "Nenhum dado coletado ainda. Rode 'npm run fetch:tse-candidatos' (ou espere o GitHub Actions rodar) para popular esta página.";
    return;
  }

  const dataGeracao = new Date(indiceAtual.gerado_em);
  avisoStatus.textContent = `${indiceAtual.aviso} Base gerada em ${dataGeracao.toLocaleString("pt-BR")}, a partir de ${indiceAtual.fonte}.`;

  popularSelectUf(indiceAtual);
  const ufInicial = document.getElementById("filtro-uf").value;
  popularSelectCargo(indiceAtual, ufInicial);

  document.getElementById("filtro-uf").addEventListener("change", (e) => {
    popularSelectCargo(indiceAtual, e.target.value);
    carregarESRenderizar();
  });
  document.getElementById("filtro-cargo").addEventListener("change", carregarESRenderizar);
  document.getElementById("filtro-busca").addEventListener("input", (e) => {
    renderizarTabela(registrosCarregados, e.target.value);
  });

  carregarESRenderizar();
}

iniciar();
