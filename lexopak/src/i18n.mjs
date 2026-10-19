const STRINGS = {
  sq: {
    tagline: "Lajme nga Kosova dhe bota",
    latest: "Më të rejat",
    noArticles: "Ende nuk ka artikuj.",
    sources: "Burimet",
    aiDisclosure: "Ky artikull u shkrua me ndihmën e AI dhe u rishikua nga redaksia e Lexopak.",
    about: "Rreth nesh",
    older: "Më të vjetra",
    newer: "Më të reja",
    notFound: "Faqja nuk u gjet",
    home: "Ballina",
    categories: {
      news: "Lajme", politics: "Politikë", economy: "Ekonomi", world: "Botë",
      sport: "Sport", culture: "Kulturë", tech: "Teknologji",
    },
    aboutBody: `<p>Lexopak është një portal i pavarur lajmesh. Ne ndjekim zhvillimet në Kosovë, rajon dhe botë dhe i raportojmë me fjalët tona.</p>
<p><strong>Si punojmë:</strong> kur një lajm del në media, redaksia jonë e verifikon me burime të tjera dhe shkruan një artikull origjinal. Përdorim mjete të inteligjencës artificiale për kërkim dhe draftim, por çdo artikull rishikohet nga një redaktor para publikimit. Në fund të çdo artikulli listojmë burimet dhe japim kredit mediave që e raportuan lajmin të parat.</p>
<p>Për korrigjime ose ankesa na shkruani.</p>`,
  },
  en: {
    tagline: "News from Kosovo and the world",
    latest: "Latest",
    noArticles: "No articles yet.",
    sources: "Sources",
    aiDisclosure: "This article was written with AI assistance and reviewed by the Lexopak newsroom.",
    about: "About",
    older: "Older",
    newer: "Newer",
    notFound: "Page not found",
    home: "Home",
    categories: {
      news: "News", politics: "Politics", economy: "Economy", world: "World",
      sport: "Sport", culture: "Culture", tech: "Tech",
    },
    aboutBody: `<p>Lexopak is an independent news site covering Kosovo, the region and the world in our own words.</p>
<p><strong>How we work:</strong> when a story breaks, our newsroom checks it against other sources and writes an original article. We use AI tools for research and drafting, but an editor reviews every article before it is published. Each article lists its sources and credits the outlets that broke the story.</p>
<p>For corrections or complaints, contact us.</p>`,
  },
};

export const t = (lang) => STRINGS[lang];
