// docs/js/app.js
// Lê os dados estáticos gerados pelos scripts de coleta (docs/data/*.json) e monta a lista
// de dossiês na página inicial. Não depende de nenhum framework — DOM puro.

async function carregarJSON(caminho) {
  try {
    const resp = await fetch(caminho, { cache: "no-cache" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function casaDoPolitico(politico) {
  if (politico.casa === "camara") return "camara";
  if (politico.casa === "senado") return "senado";
  if (politico.casa === "executivo") return "executivo";
  if (politico.casa === "municipal") return "municipal";
  if (politico.casa === "estadual" || politico.sistema === "sapl") return "estadual";
  return "outros";
}

function rotuloCasa(casa) {
  return {
    camara: "Câmara Federal",
    senado: "Senado",
    estadual: "Assembleia Estadual",
    municipal: "Câmara Municipal",
    executivo: "Poder Executivo",
  }[casa] || casa;
}

/** Decide o "carimbo" de veredito a partir da comparação por temas. Regra simples e auditável:
 *  ver quantos temas prometidos tiveram atuação encontrada versus não encontrada. */
function calcularCarimbo(comparacao) {
  if (!comparacao || comparacao.status !== "ok") {
    return { texto: "Sem dados ainda", classe: "carimbo-azul" };
  }
  const { convergente, sem_atuacao_encontrada } = comparacao.temas;
  const totalPrometido = convergente.length + sem_atuacao_encontrada.length;

  if (totalPrometido === 0) {
    return { texto: "Sem promessas cadastradas", classe: "carimbo-azul" };
  }
  const proporcao = convergente.length / totalPrometido;
  if (proporcao >= 0.6) return { texto: "Majoritariamente convergente", classe: "carimbo-verde" };
  if (proporcao >= 0.3) return { texto: "Parcialmente convergente", classe: "carimbo-azul" };
  return { texto: "Pouca atuação encontrada", classe: "carimbo-vermelho" };
}

function montarCartao(politico, comparacao) {
  const carimbo = calcularCarimbo(comparacao);
  const div = document.createElement("a");
  div.href = `politico.html?id=${encodeURIComponent(politico.id_interno)}`;
  div.className = "cartao-dossie rounded-lg p-5 flex flex-col gap-3 hover:-translate-y-0.5 transition-transform";
  div.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="font-data text-[10px] uppercase tracking-widest text-[var(--color-ink-soft)]">${rotuloCasa(casaDoPolitico(politico))}</p>
        <h3 class="font-display text-lg font-bold leading-snug">${politico.nome}</h3>
        <p class="text-sm text-[var(--color-ink-soft)]">${politico.partido || ""} ${politico.uf ? "· " + politico.uf : ""} ${politico.municipio ? "· " + politico.municipio : ""}</p>
      </div>
    </div>
    <div class="mt-1">
      <span class="carimbo ${carimbo.classe}">${carimbo.texto}</span>
    </div>
    <div class="text-xs text-[var(--color-ink-soft)] font-data mt-auto pt-2 border-t border-dashed border-[var(--color-ink)]/20">
      ${comparacao && comparacao.status === "ok"
        ? `${comparacao.total_promessas} promessa(s) · ${comparacao.total_proposicoes_autoria} proposição(ões)`
        : "aguardando coleta de dados"}
    </div>
  `;
  return div;
}

async function iniciar() {
  const [politicos, comparacoes, meta] = await Promise.all([
    carregarJSON("data/politicos.json"),
    carregarJSON("data/comparacoes/index.json"),
    carregarJSON("data/meta/ultima-atualizacao.json"),
  ]);

  const grade = document.getElementById("grade-politicos");
  const avisoVazio = document.getElementById("aviso-vazio");
  const rodape = document.getElementById("rodape-atualizacao");

  if (meta && meta.data) {
    const data = new Date(meta.data);
    rodape.textContent = `Dados atualizados automaticamente em ${data.toLocaleString("pt-BR")}.`;
  } else {
    rodape.textContent = "Este site ainda não passou pela primeira coleta automática de dados.";
  }

  const listaPoliticos = (politicos || []).filter((p) => !String(p.id_interno).startsWith("exemplo"));
  const mapaComparacoes = new Map((comparacoes || []).map((c) => [c.id_interno, c]));

  function renderizar(filtro) {
    grade.innerHTML = "";
    const filtrados = listaPoliticos.filter((p) => filtro === "todos" || casaDoPolitico(p) === filtro);
    avisoVazio.classList.toggle("hidden", filtrados.length > 0);
    for (const politico of filtrados) {
      grade.appendChild(montarCartao(politico, mapaComparacoes.get(politico.id_interno)));
    }
  }

  document.querySelectorAll("#abas .aba-pasta").forEach((botao) => {
    botao.addEventListener("click", () => {
      document.querySelectorAll("#abas .aba-pasta").forEach((b) => b.removeAttribute("data-ativa"));
      botao.setAttribute("data-ativa", "true");
      renderizar(botao.dataset.filtro);
    });
  });

  renderizar("todos");
}

iniciar();
