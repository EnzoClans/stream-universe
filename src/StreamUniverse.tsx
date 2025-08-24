import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Stream Universe — TMDb-powered PWA (React)
 * iPhone-focused + new UX when NOT available at home:
 * - BOTÕES invertidos: primeiro "Outras opções de acesso", depois "Ver em outros países".
 * - "Outras opções" agora mostra APENAS alternativas do país de casa (homeCountry).
 * - Mantém todos os fixes (scroll lock, safe-area, sugestão, etc.)
 */

// ---- Theme ----
const THEME = {
  primary: "#9526DE",
  text: "#111111",
  muted: "#6B7280",
  surface: "#FFFFFF",
  surfaceAlt: "#FBF7FF",
  border: "#E7E2F5",
};

const TMDB_IMG = "https://image.tmdb.org/t/p";

const REGIONS = [
  { code: "FR", name: "France" }, { code: "US", name: "United States" }, { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" }, { code: "BR", name: "Brazil" }, { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" }, { code: "CA", name: "Canada" }, { code: "AU", name: "Australia" },
  { code: "MX", name: "Mexico" }, { code: "NL", name: "Netherlands" }, { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" }, { code: "DK", name: "Denmark" }, { code: "FI", name: "Finland" },
  { code: "IE", name: "Ireland" }, { code: "PT", name: "Portugal" }, { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" }, { code: "CO", name: "Colombia" }, { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" }, { code: "IN", name: "India" }, { code: "TR", name: "Türkiye" },
];

function flagEmoji(cc: string) {
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function useLocalStorage(key: string, initial: string) {
  const [value, setValue] = useState<string>(() => {
    try { const v = localStorage.getItem(key); return v ?? initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, value); } catch {} }, [key, value]);
  return [value, setValue] as const;
}

function deduceRegionFallback(defaultCode = "FR") {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    const m = /[-_](..)/.exec(loc);
    const code = (m && m[1] ? m[1] : "").toUpperCase();
    return code || defaultCode;
  } catch { return defaultCode; }
}

// ---------- Relevance helpers ----------
function normalizeTitle(s: any) {
  const str = (s ?? "") + "";
  const lower = str.toLowerCase();
  let out = "";
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const code = ch.charCodeAt(0);
    const isNum = code >= 48 && code <= 57; // 0-9
    const isAlpha = code >= 97 && code <= 122; // a-z
    if (isAlpha || isNum) out += ch;
  }
  return out;
}
function extractYear(text: any) {
  const s = ((text ?? "") + "");
  let buf = "";
  let found: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= '0' && ch <= '9') {
      buf += ch;
      if (buf.length > 4) buf = buf.slice(-4);
      if (buf.length === 4) {
        if (buf.startsWith('19') || buf.startsWith('20')) found = buf;
      }
    } else {
      buf = "";
    }
  }
  return found;
}
function relevanceScore(item: any, q: string) {
  const nq = normalizeTitle(q);
  const title = item.title || item.name || "";
  const orig  = item.original_title || item.original_name || "";
  const nt = normalizeTitle(title);
  const no = normalizeTitle(orig);
  let score = 0;
  if (nt === nq || no === nq) score += 100;            // exact
  else if (nt.startsWith(nq) || no.startsWith(nq)) score += 60; // prefix
  else if ((nq && nt.indexOf(nq) !== -1) || (nq && no.indexOf(nq) !== -1)) score += 40; // contains
  const y = extractYear(q);
  if (y) {
    const itemYear = ((item.release_date || item.first_air_date || "") + "").slice(0, 4);
    if (itemYear === y) score += 20;
  }
  const pop = Number(item.popularity || 0);
  const votes = Number(item.vote_count || 0);
  score += Math.log10(pop + 1) * 10;
  score += Math.log10(votes + 1) * 2;
  return score;
}

// ---------- Debounced input ----------
const DebouncedInput: React.FC<{ value: string; onChange: (v: string) => void; onImmediateChange?: (v: string) => void; placeholder?: string; delay?: number; }> = ({ value, onChange, onImmediateChange, placeholder, delay = 350 }) => {
  const [inner, setInner] = useState(value);
  const t = useRef<number | null>(null);
  useEffect(() => setInner(value), [value]);
  useEffect(() => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => onChange(inner), delay);
    return () => { if (t.current) window.clearTimeout(t.current); };
  }, [inner]);
  return (
    <input
      value={inner}
      placeholder={placeholder}
      inputMode="search"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value; setInner(v); if (onImmediateChange) onImmediateChange(v); }}
      style={styles.input}
    />
  );
};

export default function StreamUniverse() {
  // Keys & region
  const [apiKey, setApiKey] = useLocalStorage("sc_api_key", "");
  const [homeCountry, setHomeCountry] = useLocalStorage("sc_home_country", deduceRegionFallback());
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean>(() => { try { return localStorage.getItem("sc_onboarded") === "yes"; } catch { return false; } });

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => { try { const arr = JSON.parse(localStorage.getItem("sc_recent") || "[]"); return Array.isArray(arr) ? arr.slice(0,5) : []; } catch { return []; } });

  // Selection
  const [selected, setSelected] = useState<any>(null);

  // Providers
  const [providerDirectory, setProviderDirectory] = useState<Record<number, any>>({});
  const [providerFilter, setProviderFilter] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<Set<number>>(() => { try { return new Set(JSON.parse(localStorage.getItem("sc_services") || "[]")); } catch { return new Set(); } });

  const cacheRef = useRef<Map<string, any>>(new Map());

  async function loadProvidersForRegion(region: string) {
    if (!apiKey) return;
    const urls = [
      `https://api.themoviedb.org/3/watch/providers/movie?watch_region=${region}&language=en-US&api_key=${apiKey}`,
      `https://api.themoviedb.org/3/watch/providers/tv?watch_region=${region}&language=en-US&api_key=${apiKey}`,
    ];
    const [a, b] = await Promise.all(urls.map((u) => fetch(u).then((r) => r.json())));
    const combined: Record<number, any> = {};
    for (const block of [a?.results || [], b?.results || []]) {
      for (const p of block) {
        combined[p.provider_id] = { provider_id: p.provider_id, provider_name: p.provider_name, logo_path: p.logo_path, display_priority: p.display_priority };
      }
    }
    setProviderDirectory(combined);
  }
  useEffect(() => { loadProvidersForRegion(homeCountry).catch(() => {}); }, [homeCountry, apiKey]);

  // Search with relevance
  async function doSearch(q: string) {
    if (!apiKey || !q.trim()) { setResults([]); return; }
    setLoadingSearch(true);
    try {
      const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(q)}&include_adult=false`;
      const data = await fetch(url).then((r) => r.json());
      const base = (data?.results || []).filter((x: any) => x.media_type === "movie" || x.media_type === "tv");
      base.sort((a: any, b: any) => relevanceScore(b, q) - relevanceScore(a, q));
      const parsed = base.slice(0, 12).map((x: any) => ({ id: x.id, type: x.media_type, name: x.title || x.name, year: ((x.release_date || x.first_air_date || "") + "").slice(0, 4), poster: x.poster_path }));
      setResults(parsed);
    } catch (e) { console.error(e); setResults([]); }
    finally { setLoadingSearch(false); }
  }

  async function getWatchProviders(item: { id: number; type: "movie" | "tv" }) {
    const key = `${item.type}:${item.id}`;
    if (cacheRef.current.has(key)) return cacheRef.current.get(key);
    const url = `https://api.themoviedb.org/3/${item.type}/${item.id}/watch/providers?api_key=${apiKey}`;
    const data = await fetch(url).then((r) => r.json());
    cacheRef.current.set(key, data?.results || {});
    return data?.results || {};
  }

  function toggleProvider(id: number) {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("sc_services", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }

  const providerList = useMemo(() => {
    const arr = Object.values(providerDirectory).sort((a: any, b: any) => a.display_priority - b.display_priority);
    if (!providerFilter.trim()) return arr;
    const t = providerFilter.toLowerCase();
    return arr.filter((p: any) => (p.provider_name || "").toLowerCase().includes(t));
  }, [providerDirectory, providerFilter]);

  const [analysis, setAnalysis] = useState<any>(null);
  async function analyzeSelection(sel: any) {
    const results = await getWatchProviders({ id: sel.id, type: sel.type });
    const allCountries = Object.keys(results || {});
    const subBuckets = ["flatrate", "free", "ads"] as const;
    const home = (results?.[homeCountry] || null);
    const buckets = subBuckets as readonly string[];
    const homeProviders = (home ? buckets.flatMap((b: any) => (home?.[b] || [])) : []);
    const availableAtHome = homeProviders.filter((p: any) => selectedProviders.has(p.provider_id));

    const elsewhere: any[] = [];
    for (const cc of allCountries) {
      const row = results[cc]; if (!row) continue;
      if (cc !== homeCountry) {
        const rowProviders = buckets.flatMap((b: any) => (row?.[b] || []));
        const matches = rowProviders.filter((p: any) => selectedProviders.has(p.provider_id));
        if (matches.length) elsewhere.push({ country: cc, link: row.link, matches });
      }
    }
    elsewhere.sort((a: any, b: any) => b.matches.length - a.matches.length);

    // ---- Alternatives ONLY for home country ----
    const homeAltSubs = (home ? buckets.flatMap((b: any) => (home?.[b] || [])) : []).filter((p: any) => !selectedProviders.has(p.provider_id));
    const homeAltRent = (home?.rent || []).filter((p: any) => !selectedProviders.has(p.provider_id));
    const homeAltBuy  = (home?.buy  || []).filter((p: any) => !selectedProviders.has(p.provider_id));

    setAnalysis({
      availableAtHome,
      homeData: home,
      elsewhere,
      allCountries,
      alternativesHome: { subs: homeAltSubs, rent: homeAltRent, buy: homeAltBuy },
    });
  }
  useEffect(() => { if (selected && apiKey) { analyzeSelection(selected).catch(() => {}); } else { setAnalysis(null); } }, [selected, apiKey, homeCountry, selectedProviders]);

  // Details
  const [details, setDetails] = useState<any>(null);
  async function loadDetails(item: any) {
    try {
      const base = `https://api.themoviedb.org/3/${item.type}/${item.id}`;
      const [info, vids] = await Promise.all([
        fetch(`${base}?api_key=${apiKey}&language=en-US`).then((r) => r.json()),
        fetch(`${base}/videos?api_key=${apiKey}&language=en-US`).then((r) => r.json()),
      ]);
      let trailerUrl: string | undefined;
      const vidsArr = vids?.results || [];
      const pick = vidsArr.find((v: any) => v.site === "YouTube" && v.type === "Trailer" && v.official) || vidsArr.find((v: any) => v.site === "YouTube" && v.type === "Trailer");
      if (pick && pick.key) trailerUrl = `https://www.youtube.com/watch?v=${pick.key}`;
      setDetails({ overview: info?.overview, vote_average: info?.vote_average, vote_count: info?.vote_count, trailerUrl });
    } catch (e) { console.error(e); setDetails(null); }
  }
  useEffect(() => {
    if (!selected) return;
    loadDetails(selected);
    try {
      const q = selected.name;
      const next = [q, ...recent.filter((x) => x !== q)].slice(0, 5);
      setRecent(next); localStorage.setItem("sc_recent", JSON.stringify(next));
    } catch {}
  }, [selected]);

  // Reveal toggles for the new UX (hidden by default)
  const [revealElsewhere, setRevealElsewhere] = useState(false);
  const [revealAlternatives, setRevealAlternatives] = useState(false);
  useEffect(() => { setRevealElsewhere(false); setRevealAlternatives(false); }, [selected, homeCountry]);

  // Settings modal: lock background scroll on iOS
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    if (showSettings) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showSettings]);

  // Tiny tests
  useEffect(() => {
    try {
      console.assert(normalizeTitle("Dune: Part Two (2024)") === "duneparttwo2024");
      console.assert(extractYear("dune 2021") === "2021");
      const s1 = relevanceScore({ title: "Dune", release_date: "2021-10-01" }, "dune 2021");
      const s2 = relevanceScore({ title: "Dune", release_date: "1984-01-01" }, "dune 2021");
      console.assert(s1 > s2);
      // extra tests
      console.assert(extractYear("no year here") === null);
      console.assert(normalizeTitle("Amélie (2001)!") === "amlie2001");
      console.assert(flagEmoji("FR").length >= 2);
    } catch {}
  }, []);

  return (
    <div style={{ ...styles.app, background: `linear-gradient(180deg, ${THEME.surfaceAlt}, #FFFFFF)` }}>
      <style>{`:root{--primary:${THEME.primary};--text:${THEME.text};--muted:${THEME.muted};--border:${THEME.border}}`}</style>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
            <div style={{...styles.logoCircle, background: THEME.primary}}>✶</div>
            <div style={{minWidth:0}}>
              <h1 style={styles.h1}>Stream Universe</h1>
              <p style={styles.sub}>Find where to watch — fast.</p>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
            <select value={homeCountry} onChange={(e)=>setHomeCountry((e.target as HTMLSelectElement).value)} style={styles.select}>
              {REGIONS.map((r)=>(<option key={r.code} value={r.code}>{r.code} — {r.name}</option>))}
            </select>
            <button style={styles.secondaryBtn} onClick={()=>setShowSettings(true)}>⚙️ Settings</button>
          </div>
        </header>

        {showSettings && (
          <div style={styles.modalBackdrop} onClick={()=>setShowSettings(false)}>
            <div style={styles.modal} onClick={(e)=>e.stopPropagation()}>
              <h2 style={styles.h2}>Settings</h2>
              <label style={styles.label}>TMDb API Key</label>
              <input type="password" value={apiKey} onChange={(e)=>setApiKey((e.target as HTMLInputElement).value)} placeholder="Paste API key" style={styles.input} />
              <label style={{...styles.label, marginTop:12}}>Your services</label>
              <div style={styles.providerBox}>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                  <input placeholder="Filter providers" value={providerFilter} onChange={(e)=>setProviderFilter((e.target as HTMLInputElement).value)} style={{...styles.input, margin:0}} />
                  <button style={styles.ghostBtn} onClick={()=>setSelectedProviders(new Set())}>Clear</button>
                  <button style={styles.ghostBtn} onClick={()=>setSelectedProviders(new Set(providerList.map((p: any)=>p.provider_id)))}>Select All</button>
                </div>
                <div style={{maxHeight:300, overflow:'auto', paddingRight:6, WebkitOverflowScrolling:'touch' as any}}>
                  <ul style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8}}>
                    {providerList.map((p: any)=> (
                      <li key={p.provider_id}>
                        <label style={styles.providerRow}>
                          <input type="checkbox" checked={selectedProviders.has(p.provider_id)} onChange={()=>toggleProvider(p.provider_id)} />
                          {p.logo_path ? (
                            <img src={`${TMDB_IMG}/w45${p.logo_path}`} alt="logo" style={{width:24,height:24,borderRadius:6,flex:'0 0 auto'}} />
                          ) : (<div style={{width:24,height:24,background:'#EEE',borderRadius:6,flex:'0 0 auto'}} />)}
                          <span style={styles.providerName}>{p.provider_name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:12,justifyContent:'flex-end',flexWrap:'wrap'}}>
                <button style={styles.secondaryBtn} onClick={()=>setShowSettings(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Onboarding */}
        {(!apiKey || selectedProviders.size === 0 || !hasCompletedOnboarding) ? (
          <section style={styles.cardLg}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:12}}>
              <h2 style={styles.h2}>Let’s set you up</h2>
              <span style={styles.stepBadge}>Step {(!apiKey ? 1 : 2)} of 2</span>
            </div>

            {(!apiKey) ? (
              <div>
                <label style={styles.label}>Your TMDb API Key</label>
                <input type="password" value={apiKey} onChange={(e)=>setApiKey((e.target as HTMLInputElement).value)} placeholder="Paste API key" style={styles.input} />
                <p style={styles.meta}>Stored locally on your device. You can change it later.</p>
                <div style={{display:'flex',justifyContent:'flex-end'}}>
                  <button style={styles.primaryBtn} onClick={()=> {/* go to next */}} disabled={!apiKey}>Continue</button>
                </div>
              </div>
            ) : (
              <div>
                <label style={styles.label}>Pick the services you pay for</label>
                <div style={styles.providerBox}>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                    <input placeholder="Filter providers" value={providerFilter} onChange={(e)=>setProviderFilter((e.target as HTMLInputElement).value)} style={{...styles.input, margin:0}} />
                    <button style={styles.ghostBtn} onClick={()=>setSelectedProviders(new Set())}>Clear</button>
                    <button style={styles.ghostBtn} onClick={()=>setSelectedProviders(new Set(providerList.map((p: any)=>p.provider_id)))}>Select All</button>
                  </div>
                  <div style={{maxHeight:300, overflow:'auto', paddingRight:6, WebkitOverflowScrolling:'touch' as any}}>
                    <ul style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8}}>
                      {providerList.map((p: any)=> (
                        <li key={p.provider_id}>
                          <label style={styles.providerRow}>
                            <input type="checkbox" checked={selectedProviders.has(p.provider_id)} onChange={()=>toggleProvider(p.provider_id)} />
                            {p.logo_path ? (
                              <img src={`${TMDB_IMG}/w45${p.logo_path}`} alt="logo" style={{width:24,height:24,borderRadius:6,flex:'0 0 auto'}} />
                            ) : (<div style={{width:24,height:24,background:'#EEE',borderRadius:6,flex:'0 0 auto'}} />)}
                            <span style={styles.providerName}>{p.provider_name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
                  <button style={styles.primaryBtn} onClick={()=>{ try { localStorage.setItem("sc_onboarded", "yes"); } catch {} setHasCompletedOnboarding(true); }} disabled={selectedProviders.size===0}>Finish</button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <>
            {/* Search */}
            <section>
              <label style={styles.label}>Search title</label>
              <DebouncedInput
                value={query}
                onChange={(v)=>{ setQuery(v); if (!v.trim()) { setResults([]); return; } doSearch(v); }}
                onImmediateChange={(v)=>{ if (v.trim()) setSelected(null); }}
                placeholder="e.g., The Bear, Dune, Spirited Away…"
              />
              {loadingSearch && <div style={styles.meta}>Searching…</div>}

              {recent.length > 0 && (
                <div style={{marginTop:8, display:'flex',flexWrap:'wrap', gap:8}}>
                  {recent.map((r)=> (
                    <button key={r} style={styles.pill} onClick={()=>{ setQuery(r); doSearch(r); }}>
                      {r}
                    </button>
                  ))}
                </div>
              )}

              {!!results.length && !selected && (
                <div style={styles.resultsBox}>
                  {results.map((r) => (
                    <div
                      key={`${r.type}:${r.id}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${r.name}`}
                      onKeyDown={(e)=>{ if (e.key === 'Enter') { setSelected(r); setResults([]); setQuery(""); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }}}
                      onClick={()=> { setSelected(r); setResults([]); setQuery(""); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }}
                      style={styles.resultRow}
                    >
                      {r.poster ? (<img src={`${TMDB_IMG}/w92${r.poster}`} alt="poster" style={{width:44,height:66,borderRadius:8,objectFit:'cover',flex:'0 0 auto'}} />) : (<div style={{width:44,height:66,background:'#EEE',borderRadius:8,flex:'0 0 auto'}} />)}
                      <div style={styles.resultTextCol}>
                        <div style={styles.resultTitle}>{r.name}</div>
                        {r.year ? <div style={styles.resultMeta}>({r.year}) • {String(r.type).toUpperCase()}</div> : <div style={styles.resultMeta}>{String(r.type).toUpperCase()}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Selected details & availability */}
            {selected && (
              <section style={{marginTop:16, display:'grid', gap:16}}>
                <div style={styles.cardLg}>
                  <div style={{display:'flex', gap:16, alignItems:'flex-start'}}>
                    {selected.poster ? (
                      <img src={`${TMDB_IMG}/w154${selected.poster}`} alt="poster" style={{width:112,height:164,borderRadius:16,objectFit:'cover',flex:'0 0 auto'}} />
                    ) : (<div style={{width:112,height:164,background:'#EEE',borderRadius:16,flex:'0 0 auto'}} />)}
                    <div style={{flex:1,minWidth:0}}>
                      <h2 style={styles.h2}>{selected.name} {selected.year ? <span style={{color:THEME.muted}}>({selected.year})</span> : null}</h2>
                      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:4}}>
                        {details && typeof details.vote_average === 'number' && (
                          <span style={styles.kpi}>★ {Number(details.vote_average).toFixed(1)} <span style={{color:THEME.muted}}>({details.vote_count || 0})</span></span>
                        )}
                        <span style={styles.kpi}>{String(selected.type).toUpperCase()}</span>
                      </div>
                      {details?.overview && (
                        <p style={{marginTop:8, fontSize:14, color:THEME.text, opacity:0.9}}>{details.overview}</p>
                      )}
                      <div style={{marginTop:10, display:'flex', gap:8, flexWrap:'wrap'}}>
                        {details?.trailerUrl ? (
                          <a href={details.trailerUrl} target="_blank" rel="noreferrer" style={styles.primaryBtn}>Watch Trailer</a>
                        ) : (
                          <button style={{...styles.secondaryBtn, opacity:0.7}} disabled>Trailer not found</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {analysis && (
                  <div style={styles.cardLg}>
                    <h3 style={styles.h3}>Disponibilidade em {homeCountry} {flagEmoji(homeCountry)}</h3>
                    {analysis.homeData ? (
                      analysis.availableAtHome.length ? (
                        <>
                          <p style={styles.body}>Boa! Está nos seus serviços:</p>
                          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:8}}>
                            {analysis.availableAtHome.map((p: any)=> (<ProviderPill key={p.provider_id} p={p} />))}
                          </div>
                          {analysis.homeData?.link && (
                            <p style={styles.meta}>Página fonte: <a href={analysis.homeData.link} target="_blank" rel="noreferrer" style={styles.link}>Abrir listagem regional</a></p>
                          )}
                        </>
                      ) : (
                        <>
                          <p style={styles.body}>Não disponível nos seus serviços em {homeCountry}.</p>
                          {analysis.homeData?.link && (
                            <p style={styles.meta}>Ver todos os provedores: <a href={analysis.homeData.link} target="_blank" rel="noreferrer" style={styles.link}>Listagem regional</a></p>
                          )}
                          <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:8}}>
                            {/* ORDEM INVERTIDA: primeiro Outras opções (primário), depois Outros países */}
                            <button style={styles.primaryBtn} onClick={()=>setRevealAlternatives((v)=>!v)}>
                              {revealAlternatives ? 'Ocultar outras opções' : 'Outras opções de acesso'}
                            </button>
                            <button style={styles.secondaryBtn} onClick={()=>setRevealElsewhere((v)=>!v)}>
                              {revealElsewhere ? 'Ocultar outros países' : 'Ver em outros países'}
                            </button>
                          </div>

                          {/* ALTERNATIVES (toggle) — APENAS país de casa */}
                          {revealAlternatives && (
                            <div style={{marginTop:12}}>
                              <p style={styles.meta}>Opções em {homeCountry} {flagEmoji(homeCountry)}</p>
                              {analysis.alternativesHome?.subs?.length ? (
                                <div style={{marginTop:10}}>
                                  <h4 style={{margin:'6px 0', fontWeight:700}}>Assinar outro serviço</h4>
                                  <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                                    {analysis.alternativesHome.subs.map((p: any) => (
                                      <ProviderPill key={`home-sub-${p.provider_id}`} p={p} />
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {(analysis.alternativesHome?.rent?.length || analysis.alternativesHome?.buy?.length) ? (
                                <div style={{marginTop:12}}>
                                  <h4 style={{margin:'6px 0', fontWeight:700}}>Aluguel ou compra</h4>
                                  {analysis.alternativesHome.rent?.length ? (
                                    <div style={{marginTop:6}}>
                                      <div style={styles.meta}>Alugar em:</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                                        {analysis.alternativesHome.rent.map((p: any) => (
                                          <ProviderPill key={`home-rent-${p.provider_id}`} p={p} />
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                  {analysis.alternativesHome.buy?.length ? (
                                    <div style={{marginTop:10}}>
                                      <div style={styles.meta}>Comprar em:</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                                        {analysis.alternativesHome.buy.map((p: any) => (
                                          <ProviderPill key={`home-buy-${p.provider_id}`} p={p} />
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                  <p style={{...styles.meta, marginTop:10}}>TMDb não traz preços nessa rota. Abra a listagem regional para ver valores atuais.</p>
                                </div>
                              ) : null}
                            </div>
                          )}

                          {/* ELSEWHERE (toggle) */}
                          {revealElsewhere && (
                            analysis.elsewhere.length ? (
                              <div style={{marginTop:12, display:'grid',gridTemplateColumns:'1fr',gap:12}}>
                                {analysis.elsewhere.map((row: any)=> (
                                  <div key={row.country} style={styles.countryRow}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:6}}>
                                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                                        <span style={{fontSize:20}}>{flagEmoji(row.country)}</span>
                                        <strong>{row.country}</strong>
                                      </div>
                                      {row.link && <a href={row.link} target="_blank" rel="noreferrer" style={styles.link}>Abrir listagem</a>}
                                    </div>
                                    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                                      {row.matches.map((p: any)=> (<ProviderPill key={`${row.country}:${p.provider_id}`} p={p} />))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p style={{...styles.meta, marginTop:8}}>Nenhum dos seus serviços tem esse título em outros países.</p>
                            )
                          )}
                        </>
                      )
                    ) : (
                      <p style={styles.body}>Sem dados para esta região.</p>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        <footer style={styles.footer}>Data © TMDb • Built as a personal PWA</footer>
      </div>
    </div>
  );
}

const ProviderPill: React.FC<{ p: any }> = ({ p }) => (
  <span style={styles.pillRow}>
    {p.logo_path ? (
      <img src={`${TMDB_IMG}/w45${p.logo_path}`} alt={p.provider_name} style={{width:20,height:20,borderRadius:5,flex:'0 0 auto'}} />
    ) : (
      <span style={{width:20,height:20,background:'#EEE',borderRadius:5}} />
    )}
    <span style={{maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.provider_name}</span>
  </span>
);

// ---- Inline styles ----
const styles: Record<string, CSSProperties> = {
  app: { color: THEME.text },
  container: { maxWidth: 980, margin: '0 auto', padding: '24px 16px' },
  header: { display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom: 12, flexWrap:'wrap' },
  logoCircle: { width: 36, height: 36, borderRadius: 12, color:'#fff', display:'grid', placeItems:'center', fontSize:18, boxShadow:'0 4px 16px rgba(149,38,222,0.35)' },
  h1: { margin:0, fontSize:24, fontWeight:800 },
  sub: { margin:0, fontSize:12, color: THEME.muted },
  h2: { margin:'4px 0', fontSize:20, fontWeight:700 },
  h3: { margin:'0 0 6px', fontSize:16, fontWeight:700 },
  stepBadge: { padding:'6px 10px', background:'#F2E8FF', borderRadius:999, fontSize:12, color: THEME.primary, fontWeight:600 },
  label: { display:'block', margin:'8px 0 6px', fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:0.6, color: THEME.muted },
  input: { width:'100%', padding:'10px 12px', borderRadius:12, border:`1px solid ${THEME.border}`, outline:'none', fontSize:16, background:'#fff', color: THEME.text },
  select: { padding:'8px 12px', borderRadius:12, border:`1px solid ${THEME.border}`, outline:'none', fontSize:14, background:'#fff', color: THEME.text },
  primaryBtn: { display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 14px', background: THEME.primary, color:'#fff', borderRadius:12, border:'1px solid transparent', cursor:'pointer', fontWeight:700, textDecoration:'none' },
  secondaryBtn: { display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 14px', background:'#fff', color: THEME.text, borderRadius:12, border:`1px solid ${THEME.border}`, cursor:'pointer', fontWeight:600 },
  ghostBtn: { display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8, padding:'8px 10px', background:'#fff', color: THEME.text, borderRadius:10, border:`1px solid ${THEME.border}`, cursor:'pointer', fontWeight:600 },
  pill: { padding:'6px 10px', borderRadius:999, border:`1px solid ${THEME.border}`, background:'#fff', fontSize:13, color: THEME.text },
  pillRow: { display:'inline-flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:999, border:`1px solid ${THEME.border}`, background:'#fff', fontSize:13, color: THEME.text },
  resultsBox: { marginTop:8, border:`1px solid ${THEME.border}`, borderRadius:16, background:'#fff' },
  resultRow: { display:'flex', gap:10, padding:10, width:'100%', textAlign:'left', background:'#fff', cursor:'pointer', color: THEME.text, alignItems:'center', border:0, borderBottom:`1px solid ${THEME.border}`, userSelect:'none' },
  resultTextCol: { flex:1, minWidth:0 },
  resultTitle: { fontWeight:700, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' },
  resultMeta: { fontSize:12, color: THEME.muted, textTransform:'uppercase', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' },
  meta: { fontSize:12, color: THEME.muted, marginTop:6 },
  body: { fontSize:14 },
  cardLg: { background:'#fff', border:`1px solid ${THEME.border}`, borderRadius:20, padding:16 },
  providerBox: { border:`1px solid ${THEME.border}`, borderRadius:16, padding:10, background:'#fff' },
  providerRow: { display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10, background:'#fff', border:`1px solid ${THEME.border}`, minWidth:0 },
  providerName: { overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  countryRow: { border:`1px solid ${THEME.border}`, borderRadius:16, padding:12 },
  link: { color: THEME.primary, textDecoration:'underline' },
  footer: { marginTop:24, paddingTop:12, borderTop:`1px solid ${THEME.border}`, textAlign:'center', fontSize:12, color: THEME.muted },
  kpi: { display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:'#F2E8FF', color: THEME.primary, fontWeight:700 },
  modalBackdrop: { position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:50, padding:'16px' },
  modal: { width:'min(720px, 92vw)', background:'#fff', border:`1px solid ${THEME.border}`, borderRadius:20, padding:16, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' },
};