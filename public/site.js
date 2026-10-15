(() => {
  const header = document.querySelector('.site-header');
  const menu = document.querySelector('.mobile-menu');
  if (!header) return;

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
