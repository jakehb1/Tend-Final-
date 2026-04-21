// Shared docs chrome. Nav + sidebar injected client-side.
// Pages set <body data-docs-page="getting-started"> etc.

(function(){
  const page = document.body.dataset.docsPage || '';

  // ----- NAV -----
  document.body.insertAdjacentHTML('afterbegin', `
    <nav class="nav">
      <div class="nav-inner">
        <a class="brand" href="../index.html"><span class="dot"></span><span>tend</span></a>
        <div class="nav-links">
          <a href="../platform.html">Platform</a>
          <a href="../use-cases.html">Use cases</a>
          <a href="index.html" class="active">Docs</a>
          <a href="../about.html">About</a>
        </div>
        <a href="https://cal.com/clawdbotdfw/15min" target="_blank" rel="noopener" class="nav-cta">Book a demo <span>→</span></a>
      </div>
    </nav>
  `);

  // ----- SIDEBAR -----
  const sidebar = [
    { h: 'Introduction', items: [
      ['index', 'Overview'],
      ['getting-started', 'Getting started'],
      ['mental-model', 'Mental model'],
    ]},
    { h: 'Core concepts', items: [
      ['ontology', 'Ontology'],
      ['entities', 'Entities & types'],
      ['resolution', 'Entity resolution'],
      ['policy', 'Policy & governance'],
    ]},
    { h: 'Build', items: [
      ['connectors', 'Connectors'],
      ['agents', 'Agents'],
      ['workflows', 'Workflows'],
      ['sdk', 'SDK reference'],
    ]},
    { h: 'Reference', items: [
      ['api', 'REST & GraphQL API'],
      ['cli', 'CLI'],
      ['limits', 'Limits & SLAs'],
      ['changelog', 'Changelog'],
    ]},
  ];

  const sideHtml = sidebar.map(g => `
    <div class="group">
      <div class="g-h">${g.h}</div>
      ${g.items.map(([slug, name]) => {
        const href = slug === 'index' ? 'index.html' : `${slug}.html`;
        const active = slug === page ? ' class="active"' : '';
        return `<a href="${href}"${active}>${name}</a>`;
      }).join('')}
    </div>
  `).join('');

  const aside = document.querySelector('.docs-side');
  if (aside) aside.innerHTML = sideHtml;

  // ----- TOC (right rail) - built from h2s in main -----
  const toc = document.querySelector('.toc-list');
  if (toc) {
    const h2s = document.querySelectorAll('.docs-main h2');
    toc.innerHTML = [...h2s].map(h => {
      if (!h.id) h.id = h.textContent.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      return `<a href="#${h.id}">${h.textContent}</a>`;
    }).join('');

    // scroll spy
    const links = [...toc.querySelectorAll('a')];
    function onScroll() {
      const y = window.scrollY + 120;
      let active = 0;
      h2s.forEach((h, i) => { if (h.offsetTop <= y) active = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === active));
    }
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
