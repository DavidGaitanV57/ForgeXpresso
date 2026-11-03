/**
 * Fixed genre catalog for every label a player or creator sees (studio pill, banner, start menu).
 * The director writes a free-text genre ("Shoot'em up spatial à défilement vertical avec boss géants")
 * that stays in the design for the agents; screens show only the catalog label it maps to.
 */
export type GenreLocale = "es" | "en" | "fr";

interface Genre {
  id: string;
  label: Record<GenreLocale, string>;
  test: RegExp;
}

/** Order matters: the first match wins, so specific genres come before the broad ones they contain. */
const GENRES: Genre[] = [
  { id: "shmup", label: { es: "Shoot'em up", en: "Shoot'em up", fr: "Shoot'em up" }, test: /shoot.?em.?up|shmup|bullet.?hell|matamarcianos|danmaku/i },
  { id: "beatemup", label: { es: "Beat'em up", en: "Beat'em up", fr: "Beat'em up" }, test: /beat.?em.?up|brawler|yo contra el barrio/i },
  { id: "cards", label: { es: "Cartas", en: "Card game", fr: "Cartes" }, test: /card|cartas|cartes|deck.?build|solitaire|solitario/i },
  { id: "fighting", label: { es: "Lucha", en: "Fighting", fr: "Combat" }, test: /fight|lucha|pelea|combat|box(eo|ing|e)|karate|kung.?fu|duel|wrestl|sumo/i },
  { id: "tower", label: { es: "Tower defense", en: "Tower defense", fr: "Tower defense" }, test: /tower.?defen[cs]e|defensa de torres/i },
  { id: "runner", label: { es: "Runner", en: "Runner", fr: "Runner" }, test: /runner|endless|corredor infinito|carrera infinita|course infinie/i },
  { id: "racing", label: { es: "Carreras", en: "Racing", fr: "Course" }, test: /\brac(e|ing|er)|carrera|\bcourse|kart|drift|rally/i },
  { id: "platformer", label: { es: "Plataformas", en: "Platformer", fr: "Plateforme" }, test: /plat[ae]?form|metroidvania/i },
  { id: "rhythm", label: { es: "Ritmo", en: "Rhythm", fr: "Rythme" }, test: /rhythm|ritmo|rythme|music game|musical/i },
  { id: "puzzle", label: { es: "Puzle", en: "Puzzle", fr: "Puzzle" }, test: /puzzle|puzle|rompecabezas|match.?3|sokoban|casse.?t[eê]te|l[oó]gica/i },
  { id: "rpg", label: { es: "RPG", en: "RPG", fr: "RPG" }, test: /\brpg\b|rol\b|role.?playing|jeu de r[oô]le|dungeon crawler|mazmorra/i },
  { id: "strategy", label: { es: "Estrategia", en: "Strategy", fr: "Stratégie" }, test: /strateg|estrateg|rts\b|t[aá]ctic|tactique/i },
  { id: "horror", label: { es: "Terror", en: "Horror", fr: "Horreur" }, test: /horror|terror|horreur|survival|supervivencia|survie/i },
  { id: "stealth", label: { es: "Sigilo", en: "Stealth", fr: "Infiltration" }, test: /stealth|sigilo|infiltra/i },
  { id: "sports", label: { es: "Deportes", en: "Sports", fr: "Sport" }, test: /sport|deport|f[uú]tbol|soccer|football|basket|tennis|tenis|golf|hockey|b[eé]isbol|baseball/i },
  { id: "shooter", label: { es: "Disparos", en: "Shooter", fr: "Tir" }, test: /shoot|shooter|disparo|dispara|tir\b|tireur|fps|twin.?stick|gun/i },
  { id: "simulation", label: { es: "Simulación", en: "Simulation", fr: "Simulation" }, test: /simula|tycoon|manage|gesti[oó]n|gestion|granja|farm/i },
  { id: "adventure", label: { es: "Aventura", en: "Adventure", fr: "Aventure" }, test: /adventure|aventura|aventure|explora|zelda|quest/i },
];

const ARCADE: Genre = { id: "arcade", label: { es: "Arcade", en: "Arcade", fr: "Arcade" }, test: /./ };

export function genreOf(text: string | undefined): Genre {
  const s = String(text || "");
  return GENRES.find((g) => g.test.test(s)) || ARCADE;
}

/** Short catalog label for a free-text genre, in the viewer's language. */
export function genreLabel(text: string | undefined, locale: GenreLocale = "es"): string {
  return genreOf(text).label[locale] || genreOf(text).label.es;
}
