(function () {
  "use strict";

  if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const dot = document.createElement("span");
  const glow = document.createElement("span");
  dot.className = "pln-cursor-dot";
  glow.className = "pln-cursor-glow";
  document.body.append(dot, glow);

  let mouseX = -40;
  let mouseY = -40;
  let glowX = -40;
  let glowY = -40;

  document.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%)`;
    document.documentElement.classList.add("custom-cursor-active");
  }, { passive: true });

  document.addEventListener("mouseover", (event) => {
    const interactive = event.target.closest("a, button, input, select, textarea, [role='button'], .pengusahaan-source-click");
    glow.classList.toggle("is-hovering", !!interactive);
    dot.classList.toggle("is-hovering", !!interactive);
  });

  document.addEventListener("mouseleave", () => document.documentElement.classList.remove("custom-cursor-active"));
  document.addEventListener("mouseenter", () => document.documentElement.classList.add("custom-cursor-active"));

  function animate() {
    glowX += (mouseX - glowX) * 0.18;
    glowY += (mouseY - glowY) * 0.18;
    glow.style.transform = `translate3d(${glowX}px, ${glowY}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(animate);
  }
  animate();
})();
