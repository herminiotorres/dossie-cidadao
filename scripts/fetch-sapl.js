// scripts/fetch-sapl.js
//
// Coletor GENÉRICO para qualquer Casa Legislativa (assembleia estadual ou câmara municipal)
// que rode o sistema livre SAPL (Sistema de Apoio ao Processo Legislativo). O SAPL expõe uma
// API REST em <base_url>/api/, construída com Django REST Framework.
//
// Isso NÃO cobre todas as câmaras do Brasil — cobre só as que usam SAPL e que você cadastrou
// em config/sapl-instancias.json com "ativo": true. Câmaras com sistemas próprios exigiriam um
// scraper específico para cada site, o que foge do escopo genérico deste script.
//
// Endpoints usados (podem variar ligeiramente conforme a versão do SAPL instalada por cada
// casa legislativa — por isso o script tolera campos ausentes e nunca derruba o processo
// inteiro por causa de uma instância com problema):
//   /api/parlamentares/parlamentar/{id}/
//   /api/materia/materialegislativa/?autoria__autor__parlamentar={id}
//   /api/votacao/... (varia bastante entre instâncias; ver comentário abaixo)

const fs = require("fs");
const path = require("path");
const { getJSON } = require("./lib/http");
const { classificarTexto } = require("./lib/tagging");

const RAIZ = path.join(__dirname, "..");
const politicosConfig = require(path.join(RAIZ, "config/politicos.json"));
const saplConfig = require(path.join(RAIZ, "config/sapl-instancias.json"));

async function coletarParlamentarSapl(politico) {
  const instancia = saplConfig.instancias.find(
    (i) => i.base_url === politico.sapl_instancia && i.ativo
  );
  if (!instancia) {
    console.log(`  pulando ${politico.nome}: instância SAPL não marcada como "ativo": true em config/sapl-instancias.json`);
    return null;
  }

  const base = instancia.base_url.replace(/\/$/, "");
  console.log(`\n=> ${politico.cargo}: ${politico.nome} (${base})`);

  const perfil = await getJSON(`${base}/api/parlamentares/parlamentar/${politico.id_sapl_parlamentar}/`).catch(
    (e) => {
      console.warn(`  aviso: falhou ao buscar perfil: ${e.message}`);
      return null;
    }
  );

  // Nem toda instância SAPL aceita o mesmo filtro de query string — algumas exigem
  // percorrer /api/materia/autoria/ e cruzar manualmente com o id do parlamentar.
  // Aqui tentamos o caminho mais comum primeiro.
  let materias = [];
  try {
    const resposta = await getJSON(
      `${base}/api/materia/materialegislativa/?autoria__autor__parlamentar=${politico.id_sapl_parlamentar}`
    );
    materias = resposta.results || resposta || [];
  } catch (e) {
    console.warn(`  aviso: falhou ao buscar matérias de autoria: ${e.message} (pode ser necessário ajustar o filtro para esta instância)`);
  }

  const proposicoes = materias.map((m) => {
    const ementa = m.ementa || "";
    const temas = classificarTexto(ementa);
    return {
      identificacao: `${m.tipo_materia_display || m.tipo || ""} ${m.numero || ""}/${m.ano || ""}`.trim(),
      ementa,
      temas: temas.map((t) => t.id),
    };
  });

  return {
    id_interno: politico.id_interno,
    nome: politico.nome,
    cargo: politico.cargo,
    municipio: politico.municipio,
    instancia_sapl: base,
    perfil,
    proposicoes_autoria: proposicoes,
    votos: [], // Votação nominal no SAPL varia MUITO entre instâncias; ver nota no README
    atualizado_em: new Date().toISOString(),
  };
}

async function main() {
  const outDir = path.join(RAIZ, "docs/data/estadual");
  const outDirMunicipal = path.join(RAIZ, "docs/data/municipal");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(outDirMunicipal, { recursive: true });

  const alvos = politicosConfig.politicos.filter((p) => p.sistema === "sapl" && p.sapl_instancia);
  if (alvos.length === 0) {
    console.log("Nenhum parlamentar com 'sistema: sapl' configurado em config/politicos.json. Nada a fazer.");
    return;
  }

  for (const politico of alvos) {
    try {
      const dados = await coletarParlamentarSapl(politico);
      if (!dados) continue;
      const destino = politico.casa === "municipal" ? outDirMunicipal : outDir;
      fs.writeFileSync(path.join(destino, `${politico.id_interno}.json`), JSON.stringify(dados, null, 2));
      console.log(`  ok: ${dados.proposicoes_autoria.length} matérias encontradas.`);
    } catch (erro) {
      console.error(`  ERRO ao coletar ${politico.nome}: ${erro.message}`);
    }
  }

  console.log("\nSAPL: coleta finalizada.");
}

main().catch((e) => {
  console.error("Erro fatal em fetch-sapl.js:", e);
  process.exit(1);
});
