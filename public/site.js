(() => {
  const header = document.querySelector('.site-header');
  const menu = document.querySelector('.mobile-menu');
  if (!header) return;

  document.querySelectorAll('a[href="/the-lab"]').forEach((link) => {
    if (link.textContent.trim() === 'The Lab') link.textContent = 'Services';
  });

  const footerGrid = document.querySelector('.footer-grid');
  if (footerGrid && !footerGrid.querySelector('.visual-disclosure')) {
    const disclosure = document.createElement('div');
    disclosure.className = 'visual-disclosure';
    disclosure.textContent = 'Selected site imagery is illustrative and may include digitally created or concept visuals. Such imagery represents XGL’s field, design, and institutional direction—not completed XGL-owned vehicles, facilities, client work, or partnerships unless identified otherwise.';
    footerGrid.appendChild(disclosure);
  }

  let previousY = window.scrollY;
  let scheduled = false;

  const closeMenu = () => {
    if (menu?.open) menu.removeAttribute('open');
  };

  menu?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (event) => {
    if (menu?.open && !menu.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1120) closeMenu();
  });

  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const movement = currentY - previousY;

      if (menu?.open && Math.abs(movement) > 4) closeMenu();

      if (currentY <= 24 || movement < -5) {
        header.classList.remove('site-header--hidden');
      } else if (currentY > 120 && movement > 7) {
        header.classList.add('site-header--hidden');
      }

      previousY = currentY;
      scheduled = false;
    });
  }, { passive: true });
})();
