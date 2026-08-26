// docs/js/dossie.js
// Monta a página de dossiê individual (politico.html?id=...) a partir dos JSONs estáticos.

async function carregarJSON(caminho) {
  try {
    const resp = await fetch(caminho, { cache: "no-cache" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function nomeTema(id, temasConfig) {
  const tema = (temasConfig?.temas || []).find((t) => t.id === id);
  return tema ? tema.nome : id;
}

function pastaDeDados(politico) {
  if (politico.casa === "camara") return "camara";
  if (politico.casa === "senado") return "senado";
  if (politico.casa === "executivo") return "executivo";
  if (politico.casa === "municipal") return "municipal";
  return "estadual";
}

function elemento(tag, classes, html) {
  const el = document.createElement(tag);
  if (classes) el.className = classes;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function secaoTemas(titulo, ids, temasConfig, corTexto) {
  if (!ids || ids.length === 0) {
    return elemento("p", "text-sm text-[var(--color-ink-soft)] italic", "Nenhum tema nesta categoria.");
  }
  const wrap = elemento("div", "flex flex-wrap gap-2");
  for (const id of ids) {
    wrap.appendChild(elemento("span", `etiqueta-tema ${corTexto}`, nomeTema(id, temasConfig)));
  }
  const container = elemento("div", "mb-5");
  container.appendChild(elemento("h3", "font-display font-bold mb-2", titulo));
  container.appendChild(wrap);
  return container;
}

async function iniciar() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const conteudo = document.getElementById("conteudo");

  if (!id) {
    conteudo.innerHTML = `<p>Nenhum político especificado. <a class="underline" href="index.html">Voltar</a>.</p>`;
    return;
  }

  const [politicos, comparacao, temasConfig] = await Promise.all([
    carregarJSON("data/politicos.json"),
    carregarJSON(`data/comparacoes/${id}.json`),
    carregarJSON("data/temas.json"),
  ]);

  const politico = (politicos || []).find((p) => p.id_interno === id);
  if (!politico) {
    conteudo.innerHTML = `<p>Político não encontrado. <a class="underline" href="index.html">Voltar</a>.</p>`;
    return;
  }

  const dadosBrutos = await carregarJSON(`data/${pastaDeDados(politico)}/${id}.json`);

  conteudo.innerHTML = "";

  // Cabeçalho do dossiê
  const header = elemento("div", "cartao-dossie rounded-lg p-6 mb-8");
  header.innerHTML = `
    <p class="font-data text-xs uppercase tracking-widest text-[var(--color-ink-soft)]">${politico.cargo || ""}</p>
    <h1 class="font-display text-3xl font-bold mt-1">${politico.nome}</h1>
    <p class="text-[var(--color-ink-soft)] mt-1">
      ${politico.partido || ""} ${politico.uf ? "· " + politico.uf : ""} ${politico.municipio || politico.municipio_ou_uf || ""}
    </p>
    ${politico.fonte_dados ? `<p class="mt-2 text-xs"><a class="underline decoration-dotted" href="${politico.fonte_dados}" target="_blank" rel="noopener">Ver fonte oficial dos dados →</a></p>` : ""}
  `;
  conteudo.appendChild(header);

  if (!comparacao || comparacao.status !== "ok") {
    conteudo.appendChild(
      elemento(
        "p",
        "text-[var(--color-ink-soft)] italic",
        comparacao?.mensagem || "Ainda não há dados coletados ou promessas cadastradas para este político."
      )
    );
    return;
  }

  // Promessas de campanha
  const secaoPromessas = elemento("section", "cartao-dossie rounded-lg p-6 mb-6");
  secaoPromessas.appendChild(elemento("h2", "font-display text-xl font-bold mb-3", "Promessas de campanha"));
  if ((politico.promessas_campanha || []).length === 0) {
    secaoPromessas.appendChild(elemento("p", "text-sm italic text-[var(--color-ink-soft)]", "Nenhuma promessa cadastrada ainda."));
  } else {
    const lista = elemento("ul", "space-y-3");
    for (const promessa of politico.promessas_campanha) {
      const item = elemento("li", "border-l-2 border-[var(--color-brass)] pl-3");
      item.innerHTML = `
        <p>${promessa.texto}</p>
        <p class="text-xs text-[var(--color-ink-soft)] mt-1 font-data">
          ${(promessa.temas || []).map((t) => nomeTema(t, temasConfig)).join(", ")}
          ${promessa.fonte ? ` · <a class="underline" href="${promessa.fonte}" target="_blank" rel="noopener">fonte</a>` : ""}
        </p>
      `;
      lista.appendChild(item);
    }
    secaoPromessas.appendChild(lista);
  }
  conteudo.appendChild(secaoPromessas);

  // Plano de governo oficial (PDF do TSE) — só para cargos executivos, e só quando o script
  // fetch-tse-planos-governo.js já rodou para este político.
  if (politico.casa === "executivo") {
    const planoGoverno = await carregarJSON(`data/executivo/${id}-proposta-governo.json`);
    if (planoGoverno) {
      const secaoPlano = elemento("section", "cartao-dossie rounded-lg p-6 mb-6");
      secaoPlano.appendChild(elemento("h2", "font-display text-xl font-bold mb-3", "Plano de governo oficial (TSE)"));

      const c = planoGoverno.correspondencia;
      if (c.confianca === "alta") {
        secaoPlano.innerHTML += `
          <p class="text-sm">Documento localizado automaticamente com alta confiança (${c.metodo}).</p>
          ${c.referencia ? `<p class="mt-2"><a class="underline decoration-dotted" href="${c.referencia}" target="_blank" rel="noopener">Abrir plano de governo (PDF) →</a></p>` : ""}
        `;
      } else if (c.confianca === "media" || c.confianca === "baixa") {
        secaoPlano.innerHTML += `
          <p class="text-sm text-[var(--color-ink-soft)] italic">
            Possível correspondência encontrada (confiança: ${c.confianca} — ${c.metodo}), mas ainda
            não confirmada manualmente: arquivo <span class="font-data">${c.arquivo}</span>.
            Consulte <span class="font-data">docs/data/tse/propostas-governo/${planoGoverno.uf_consultada}.json</span>
            para conferir antes de divulgar como certeza.
          </p>
        `;
      } else {
        secaoPlano.innerHTML += `<p class="text-sm text-[var(--color-ink-soft)] italic">Nenhum plano de governo localizado automaticamente ainda.</p>`;
      }
      conteudo.appendChild(secaoPlano);
    }
  }

  // Veredito por tema
  const secaoVeredito = elemento("section", "cartao-dossie rounded-lg p-6 mb-6");
  secaoVeredito.appendChild(elemento("h2", "font-display text-xl font-bold mb-4", "Cruzamento promessa × atuação (por tema)"));
  secaoVeredito.appendChild(secaoTemas("Convergente (prometeu e atuou no tema)", comparacao.temas.convergente, temasConfig, "carimbo-verde-fraco"));
  secaoVeredito.appendChild(secaoTemas("Prometido, sem atuação encontrada", comparacao.temas.sem_atuacao_encontrada, temasConfig, "carimbo-vermelho-fraco"));
  secaoVeredito.appendChild(secaoTemas("Atuou fora do que foi prometido", comparacao.temas.atuacao_fora_das_promessas, temasConfig, "carimbo-azul-fraco"));
  conteudo.appendChild(secaoVeredito);

  // Proposições de autoria
  const proposicoes = dadosBrutos?.proposicoes_autoria || [];
  const secaoProps = elemento("section", "cartao-dossie rounded-lg p-6 mb-6");
  secaoProps.appendChild(elemento("h2", "font-display text-xl font-bold mb-3", `Proposições de autoria (${proposicoes.length})`));
  if (proposicoes.length === 0) {
    secaoProps.appendChild(elemento("p", "text-sm italic text-[var(--color-ink-soft)]", "Nenhuma proposição de autoria encontrada nos dados coletados."));
  } else {
    const lista = elemento("ul", "space-y-2 max-h-96 overflow-y-auto pr-2");
    for (const prop of proposicoes.slice(0, 200)) {
      lista.appendChild(
        elemento(
          "li",
          "text-sm border-b border-dashed border-[var(--color-ink)]/15 pb-2",
          `<span class="font-data">${prop.siglaTipo || prop.identificacao || ""} ${prop.numero || ""}${prop.ano ? "/" + prop.ano : ""}</span> — ${prop.ementa || "(sem ementa disponível)"}`
        )
      );
    }
    secaoProps.appendChild(lista);
  }
  conteudo.appendChild(secaoProps);

  // Votos
  const votos = dadosBrutos?.votos || [];
  const secaoVotos = elemento("section", "cartao-dossie rounded-lg p-6");
  secaoVotos.appendChild(elemento("h2", "font-display text-xl font-bold mb-3", `Votos registrados (${votos.length})`));
  if (votos.length === 0) {
    secaoVotos.appendChild(elemento("p", "text-sm italic text-[var(--color-ink-soft)]", "Nenhum voto nominal encontrado nos dados coletados (ou não aplicável a este cargo)."));
  } else {
    secaoVotos.appendChild(
      elemento(
        "p",
        "text-xs text-[var(--color-ink-soft)] font-data",
        "Lista detalhada de votos por proposição é uma melhoria futura — hoje mostramos só o total coletado, ver README (Roadmap)."
      )
    );
  }
  conteudo.appendChild(secaoVotos);
}

iniciar();
