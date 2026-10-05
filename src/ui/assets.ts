/*
THESIS — IssuePages is a publication index, not a marketing site.
OWN-WORLD — Neutral paper, exact type, permanent issue numbers, and one blue link colour.
STORY — Understand the mechanism, publish once, then read what people have left behind.
FIRST VIEWPORT — One statement, one action, no decorative demonstration.
FORM — A quiet web publication whose provenance stays visible.
*/
export const styles = `
:root {
  --background:#fbfbfa; --surface:#fff; --subtle:#f6f8fa; --text:#1f2328;
  --muted:#57606a; --border:#d0d7de; --border-strong:#8c959f;
  --accent:#0969da; --accent-hover:#0550ae; --success:#1a7f37;
  --danger:#cf222e; --focus:#0969da;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SFMono-Regular","Cascadia Code","Roboto Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{color-scheme:light;scroll-behavior:smooth}
body{margin:0;background:var(--background);color:var(--text);font-family:var(--sans);line-height:1.55;text-rendering:optimizeLegibility}
a{color:var(--accent);text-underline-offset:.18em}
a:hover{color:var(--accent-hover);text-decoration-thickness:.12em}
img{max-width:100%;height:auto}
button,input,select{font:inherit}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.skip-link{position:fixed;top:.75rem;left:.75rem;z-index:100;transform:translateY(-180%);background:var(--text);color:#fff;padding:.65rem 1rem}
.skip-link:focus{transform:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

.site-header{border-bottom:1px solid var(--border);background:rgba(251,251,250,.96)}
.site-header__inner{max-width:1040px;min-height:64px;margin:0 auto;padding:.65rem 1.5rem;display:flex;align-items:center;gap:1.5rem}
.brand{min-height:44px;display:inline-flex;align-items:center;color:var(--text);font-size:1.05rem;font-weight:700;letter-spacing:-.02em;text-decoration:none}
.site-nav{margin-left:auto;display:flex;align-items:center;gap:.25rem}
.nav-link{min-height:44px;display:inline-flex;align-items:center;padding:.55rem .7rem;color:var(--muted);font-size:.875rem;font-weight:600;text-decoration:none;border-radius:6px}
.nav-link:hover,.nav-link[aria-current="page"]{background:var(--subtle);color:var(--text)}
.nav-link--primary,.nav-link--primary:hover{background:var(--text);color:#fff}

main{min-height:72vh}
.hero{max-width:920px;margin:0 auto;padding:clamp(4.5rem,10vw,7.5rem) 1.5rem clamp(4rem,8vw,6rem)}
.field-note,.eyebrow{margin:0 0 1rem;color:var(--muted);font-family:var(--mono);font-size:.78rem;font-weight:600}
.hero h1{max-width:15ch;margin:0;font-size:clamp(2.7rem,6.6vw,4.8rem);font-weight:720;line-height:1.02;letter-spacing:-.04em;text-wrap:balance}
.hero-copy{max-width:40rem;margin:1.5rem 0;color:var(--muted);font-size:clamp(1.05rem,2vw,1.2rem);line-height:1.65}
.hero-actions{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.button{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:.75rem;border:1px solid var(--text);border-radius:6px;background:var(--text);color:#fff;padding:.7rem 1rem;font-size:.875rem;font-weight:650;text-decoration:none}
.button:hover{background:#000;color:#fff;text-decoration:none}
.button--light{border-color:var(--border-strong);background:var(--surface);color:var(--text)}
.button--light:hover{background:var(--subtle);color:var(--text)}
.text-link{min-height:44px;display:inline-flex;align-items:center;font-size:.875rem;font-weight:600}
.publish-trust,.pilot-notice{max-width:42rem;margin:1rem 0 0;color:var(--muted);font-size:.82rem}
.pilot-notice{border-top:1px solid var(--border);padding-top:.9rem}

.section,.reader-callout{max-width:920px;margin:0 auto;padding-inline:1.5rem}
.section{padding-top:1.5rem;padding-bottom:4.5rem}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:.5rem}
.section-head h2,.reader-callout h2{margin:0;font-size:1.15rem;letter-spacing:-.02em}
.section-head .text-link{color:var(--muted);font-size:.8rem}
.reader-callout{display:flex;align-items:center;justify-content:space-between;gap:2rem;border-block:1px solid var(--border);padding-top:1.5rem;padding-bottom:1.5rem;margin-bottom:3rem}
.reader-callout p{margin:.2rem 0 0;color:var(--muted);font-size:.9rem}
.reader-callout__actions{display:flex;gap:1.25rem;flex-wrap:wrap}

.listing{border-bottom:1px solid var(--border)}
.page-strip{min-height:82px;display:grid;grid-template-columns:4.25rem minmax(0,1fr) auto;align-items:stretch;border-top:1px solid var(--border)}
.page-strip__number{display:flex;align-items:center;padding:.9rem .75rem .9rem 0;color:var(--accent);font-family:var(--mono);font-size:.82rem;font-weight:650;text-decoration:none}
.page-strip__body{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.2rem;padding:.9rem .75rem}
.page-strip__title{overflow-wrap:anywhere;color:var(--text);font-size:1rem;font-weight:650;line-height:1.35;text-decoration:none}
.page-strip__title:hover{color:var(--accent)}
.page-strip__meta{color:var(--muted);font-size:.78rem}
.page-strip__meta a{color:inherit}
.page-strip__date{min-width:7.75rem;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;gap:.15rem;padding:.9rem 0 .9rem .75rem;color:var(--muted);font-size:.75rem;white-space:nowrap}
.page-strip__date>span{color:var(--text);font-size:.72rem;font-weight:600}
.reader-strip{min-height:104px}
.reader-strip__excerpt{max-width:58ch;margin:.25rem 0 0;color:var(--muted);font-size:.84rem;line-height:1.5}

.page-shell{max-width:760px;margin:0 auto;padding:clamp(3rem,7vw,6rem) 1.5rem 5rem}
.page-rail{border-bottom:1px solid var(--border);padding-bottom:2rem;margin-bottom:2.5rem}
.page-rail>.eyebrow{margin-bottom:1.25rem;color:var(--accent);font-size:.85rem}
.page-rail h1{max-width:18ch;margin:0 0 1.5rem;font-size:clamp(2.35rem,7vw,4.25rem);line-height:1.04;letter-spacing:-.04em;text-wrap:balance}
.page-rail dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.35rem 1rem;margin:1.25rem 0;color:var(--muted);font-size:.82rem}
.page-rail dt{color:var(--text);font-weight:650}
.page-rail dd{margin:0}.page-rail dd a{color:inherit}
.rail-back{display:block;margin-top:1rem;color:var(--muted);font-size:.82rem}
.article-pane{min-width:0}.article-route{display:none}

.prose{max-width:72ch;font-size:clamp(1.04rem,1.5vw,1.12rem);line-height:1.78;overflow-wrap:anywhere}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h1,.prose h2,.prose h3,.prose h4{margin:2.2em 0 .65em;line-height:1.2;letter-spacing:-.025em}
.prose h1{font-size:2.15rem}.prose h2{padding-bottom:.35rem;border-bottom:1px solid var(--border);font-size:1.65rem}.prose h3{font-size:1.3rem}
.prose p,.prose ul,.prose ol,.prose blockquote,.prose pre,.prose table,.prose details{margin:1.2em 0}
.prose li+li{margin-top:.35rem}
.prose blockquote{margin-inline:0;border-left:3px solid var(--border-strong);padding-left:1rem;color:var(--muted)}
.prose code{border-radius:4px;background:var(--subtle);padding:.12em .35em;font-family:var(--mono);font-size:.88em}
.prose pre{overflow:auto;border:1px solid var(--border);border-radius:6px;background:#24292f;color:#f6f8fa;padding:1rem}
.prose pre code{background:transparent;padding:0;color:inherit}
.prose table{width:100%;display:block;overflow-x:auto;border-collapse:collapse}
.prose th,.prose td{border:1px solid var(--border);padding:.55rem .7rem;text-align:left}
.prose th{background:var(--subtle);font-weight:650}
.prose hr{height:1px;margin:2.5rem 0;border:0;background:var(--border)}
.prose img{border-radius:4px}.prose input[type="checkbox"]{margin-right:.45rem}
.prose details,.markdown-alert,.rich-block{border:1px solid var(--border);border-radius:6px;background:var(--surface);padding:.9rem 1rem}
.prose summary{cursor:pointer;font-weight:650}.markdown-alert>:first-child{margin-top:0}.markdown-alert>:last-child{margin-bottom:0}
.mermaid,.math-display{max-width:100%;overflow-x:auto}.highlight{overflow:auto}

.tags{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1rem}
.tag{border:1px solid var(--border);border-radius:999px;background:var(--subtle);color:var(--muted);padding:.25rem .55rem;font-size:.72rem;font-weight:600;text-decoration:none}
.reactions{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin-top:2.5rem;border-top:1px solid var(--border);padding-top:1rem}
.reactions__label{margin-right:.25rem;color:var(--muted);font-size:.78rem}
.reaction{border:1px solid var(--border);border-radius:999px;background:var(--surface);padding:.25rem .5rem;font-size:.78rem}
.archive-notice,.reader-notice,.empty-state{border:1px solid var(--border);border-radius:6px;background:var(--subtle);padding:.9rem 1rem;color:var(--muted);font-size:.86rem}
.archive-notice{margin-bottom:1.5rem}.discussion{margin-top:4rem}
.discussion h2{display:flex;justify-content:space-between;gap:1rem;margin:0;border-bottom:1px solid var(--border);padding-bottom:.75rem;font-size:1.35rem}
.discussion h2 span{color:var(--muted);font-family:var(--mono);font-size:.8rem}
.comment{display:grid;grid-template-columns:2.5rem minmax(0,1fr);gap:1rem;border-bottom:1px solid var(--border);padding:1.5rem 0}
.avatar{width:2.5rem;height:2.5rem;border-radius:50%;background:var(--subtle)}
.comment__meta{margin-bottom:.75rem;color:var(--muted);font-size:.78rem}.comment .prose{font-size:.98rem}
.discussion-loading{display:flex;gap:.8rem;padding:1.5rem 0;color:var(--muted)}
.onward{display:grid;gap:.55rem;margin-top:4rem;border-top:1px solid var(--border);padding-top:1.25rem}
.onward h2{margin:0 0 .25rem;font-size:1rem}.onward a{font-size:.9rem}

.listing-shell,.reader-shell,.embed-builder{max-width:920px;margin:0 auto;padding:clamp(3.5rem,8vw,6rem) 1.5rem 5rem}
.listing-title,.reader-intro h1,.embed-builder__intro h1{max-width:18ch;margin:0 0 1rem;font-size:clamp(2.35rem,6vw,4rem);line-height:1.05;letter-spacing:-.04em;overflow-wrap:anywhere}
.listing-intro,.reader-intro>p:last-child,.embed-builder__intro>p:last-child{max-width:46rem;margin:0 0 2.5rem;color:var(--muted);font-size:1.02rem}
.identity-strip{display:flex;align-items:center;gap:1rem;margin-bottom:2rem;border-bottom:1px solid var(--border);padding-bottom:1.25rem}
.identity-strip .eyebrow{margin-bottom:.2rem}.avatar--large{width:4rem;height:4rem}
.pagination{display:flex;justify-content:flex-end;gap:1rem;margin-top:2rem}.pagination--reader{justify-content:space-between;align-items:center}
.result{border-top:1px solid var(--border);padding:1.25rem 0}.result:last-child{border-bottom:1px solid var(--border)}
.result h2{margin:0 0 .35rem;font-size:1.15rem}.result p{margin:.35rem 0 0;color:var(--muted)}
mark{background:#fff8c5;color:inherit;padding:.05em .1em}.error-code{margin-bottom:1rem;color:var(--muted);font-family:var(--mono);font-size:1rem;font-weight:650}

.search-form{display:flex;margin:0 0 2rem}.search-form input{min-width:0;flex:1;min-height:48px;border:1px solid var(--border-strong);border-radius:6px 0 0 6px;background:var(--surface);padding:.7rem .8rem}
.search-form button{min-width:96px;border:1px solid var(--text);border-radius:0 6px 6px 0;background:var(--text);color:#fff;cursor:pointer;font-weight:650}
.reader-shell,.embed-builder{display:grid;grid-template-columns:minmax(0,1fr);gap:2.5rem}.reader-shell>*,.embed-builder>*{min-width:0}.repo-form{display:grid;gap:.75rem;border-top:1px solid var(--border);padding-top:2rem}
.repo-form label{font-size:.82rem;font-weight:650}.repo-form label span{color:var(--muted);font-weight:400}
.repo-form__control{display:grid;grid-template-columns:minmax(0,1fr) auto}
.repo-form input,.repo-form select{min-width:0;min-height:48px;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface);color:var(--text);padding:.7rem .8rem}
.repo-form__control input{border-radius:6px 0 0 6px}
.repo-form button,.embed-config>button{min-height:48px;border:1px solid var(--text);border-radius:0 6px 6px 0;background:var(--text);color:#fff;padding:.7rem 1rem;cursor:pointer;font-weight:650}
.embed-config>button{justify-self:start;border-radius:6px}.repo-form>p{margin:0;color:var(--muted);font-size:.8rem}.field-error{color:var(--danger)!important}
.reader-boundary{display:grid;grid-template-columns:12rem minmax(0,1fr);gap:1rem;border-block:1px solid var(--border);padding:1.25rem 0;color:var(--muted);font-size:.88rem}
.reader-boundary strong{color:var(--text)}.embed-config__options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}
.embed-config__options label{display:grid;gap:.35rem}.embed-config input[type="color"]{width:100%;padding:.25rem}
.embed-code,.embed-preview{border-top:1px solid var(--border);padding-top:2rem}.embed-code h2,.embed-preview h2{margin:0;font-size:1.35rem}
.embed-code pre{overflow:auto;border-radius:6px;background:#24292f;color:#f6f8fa;padding:1rem}.embed-code>p{color:var(--muted);font-size:.86rem}
.reader-actions{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1.5rem}.reader-notice{margin-bottom:1.5rem}.repo-slash{color:var(--muted)}

.site-footer{border-top:1px solid var(--border)}
.site-footer__inner{max-width:1040px;margin:0 auto;padding:1.5rem;display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;color:var(--muted);font-size:.78rem}
.site-footer a{color:inherit}
.site-footer__links{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;min-width:0;margin:0;padding:0;list-style:none;color:var(--muted);font-size:.78rem}
.site-footer__links li{display:flex;align-items:center;min-width:0}
.site-footer__links a{color:inherit}

@media(max-width:760px){
  .site-header__inner{gap:.5rem}.site-nav{gap:0}.nav-link{justify-content:center;padding-inline:.55rem}
  .hero{padding-top:4rem;padding-bottom:3.5rem}.reader-callout{align-items:flex-start;flex-direction:column;gap:.8rem}
  .page-strip{grid-template-columns:3.5rem minmax(0,1fr)}.page-strip__number{grid-row:1/3;align-items:flex-start;padding-top:1rem}.page-strip__body{padding-right:0}
  .page-strip__date{grid-column:2;min-width:0;align-items:flex-start;padding:0 0 .9rem .75rem}.page-strip__date>span{display:none}
  .reader-strip .page-strip__number{grid-row:1/3}.page-rail h1{font-size:clamp(2.15rem,9.5vw,3rem)}
  .reader-boundary{grid-template-columns:1fr}.embed-config__options{grid-template-columns:1fr}.pagination--reader{align-items:flex-start;flex-direction:column}
}
@media(max-width:480px){
  .site-header__inner,.hero,.section,.reader-callout,.page-shell,.listing-shell,.reader-shell,.embed-builder,.site-footer__inner{padding-left:1rem;padding-right:1rem}
  .brand{font-size:1rem}.nav-link{padding-inline:.45rem;font-size:.8rem}
  .hero h1{font-size:clamp(2.35rem,12vw,3.15rem)}.hero-actions{align-items:stretch;flex-direction:column}.hero-actions .button,.hero-actions .text-link{width:100%;justify-content:center}
  .repo-form__control{grid-template-columns:1fr}.repo-form__control input{border-radius:6px 6px 0 0}.repo-form__control button{border-radius:0 0 6px 6px}
  .search-form{display:grid}.search-form input{border-radius:6px 6px 0 0}.search-form button{min-height:46px;border-radius:0 0 6px 6px}
  .comment{grid-template-columns:2rem minmax(0,1fr);gap:.75rem}.avatar{width:2rem;height:2rem}
}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

export const articlePollingScript = `
(() => {
  const root = document.querySelector("[data-article-version]");
  if (!root) return;
  const issue = root.getAttribute("data-article-issue");
  let version = Number(root.getAttribute("data-article-version"));
  let timer;
  let delay = 15000;
  const schedule = () => {
    clearTimeout(timer);
    if (document.visibilityState === "visible") timer = setTimeout(poll, delay);
  };
  const poll = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const response = await fetch("/api/articles/" + encodeURIComponent(issue) + "/version", {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (response.ok) {
        const payload = await response.json();
        if (typeof payload.revision === "number" && payload.revision > version) {
          version = payload.revision;
          window.location.reload();
          return;
        }
      }
    } catch (_) {}
    delay = Math.min(delay * 2, 60000);
    schedule();
  };
  const start = () => {
    clearTimeout(timer);
    if (document.visibilityState === "visible") {
      delay = 15000;
      schedule();
    }
  };
  document.addEventListener("visibilitychange", start);
  start();
})();
`;
