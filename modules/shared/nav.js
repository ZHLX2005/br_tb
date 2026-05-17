/**
 * Shared Navigation Module
 * Renders unified nav bar. Auto-detects current page to highlight active tab.
 * Each page must include: <script type="module" src="../shared/nav.js"></script>
 */

(function renderNav() {
  const navItems = [
    { id: 'timeline', label: 'Time', href: '../timeline/timeline.html' },
    { id: 'group', label: 'Board', href: '../group/group.html' },
    { id: 'recording', label: 'Rec', href: '../recording/recording.html' }
  ];

  // Detect current page from URL
  const currentPath = window.location.pathname;
  let currentId = 'timeline';
  if (currentPath.includes('/group/')) currentId = 'group';
  else if (currentPath.includes('/recording/')) currentId = 'recording';

  // Find or create header-right container
  let headerRight = document.querySelector('.header-right');
  if (!headerRight) {
    // If page doesn't have header, create minimal nav container at body top
    const navContainer = document.createElement('div');
    navContainer.className = 'header';
    navContainer.innerHTML = `
      <div class="header-left">
        <h1>TabBoard</h1>
      </div>
      <div class="header-right"></div>
    `;
    document.body.insertBefore(navContainer, document.body.firstChild);
    headerRight = navContainer.querySelector('.header-right');
  }

  // Create nav
  const nav = document.createElement('nav');
  nav.className = 'view-nav';
  nav.innerHTML = navItems.map(item => `
    <button class="nav-btn ${item.id === currentId ? 'active' : ''}"
            data-href="${item.href}"
            title="${item.label}">
      ${item.label}
    </button>
  `).join('');

  nav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = btn.dataset.href;
    });
  });

  headerRight.appendChild(nav);
})();
