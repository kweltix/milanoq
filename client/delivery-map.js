(function (root) {
  'use strict';
  const namespace = 'http://www.w3.org/2000/svg';
  let serial = 0;

  function element(tag, attributes = {}) {
    const node = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, String(value));
    return node;
  }

  function mount(section, cities) {
    const container = section?.querySelector('.wh-mi');
    const origin = cities.find((city) => city[0] === 'Москва');
    if (!container || !origin) return () => {};
    const desktop = matchMedia('(min-width:1101px)');
    const reduced = matchMedia('(prefers-reduced-motion:reduce)');
    const html = document.documentElement;
    const controller = new AbortController();
    let svg = null,
      visible = false,
      started = false,
      disposed = false;
    let transitions = [];

    function build() {
      const id = 'delivery-' + ++serial;
      const x = Number(origin[1]),
        y = (Number(origin[2]) * 9) / 16;
      const layer = element('svg', {
        class: 'delivery-map',
        viewBox: '0 0 100 56.25',
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      });
      const routes = element('g');
      const packets = element('g', { class: 'delivery-packets' });
      let routeIndex = 0;
      cities.forEach((city, cityIndex) => {
        if (
          city === origin ||
          !Number.isFinite(Number(city[1])) ||
          !Number.isFinite(Number(city[2]))
        )
          return;
        const endX = Number(city[1]),
          endY = (Number(city[2]) * 9) / 16;
        const lift = Math.min(
          8,
          Math.max(2, Math.hypot(endX - x, endY - y) * 0.32),
        );
        const pathId = id + '-route-' + routeIndex;
        const path = element('path', {
          id: pathId,
          class: 'delivery-route',
          pathLength: '1',
          'data-city-index': cityIndex,
          d: `M${x} ${y}Q${(x + endX) / 2} ${(y + endY) / 2 - lift} ${endX} ${endY}`,
        });
        path.style.setProperty('--route-index', routeIndex);
        routes.append(path);
        const begin = (2 + routeIndex * 0.22).toFixed(2) + 's';
        const packet = element('circle', {
          class: 'delivery-packet',
          r: '.27',
          opacity: '0',
        });
        const motion = element('animateMotion', {
          begin,
          dur: (2.6 + routeIndex * 0.19).toFixed(2) + 's',
          repeatCount: 'indefinite',
        });
        motion.append(element('mpath', { href: '#' + pathId }));
        packet.append(
          motion,
          element('set', {
            attributeName: 'opacity',
            to: '1',
            begin,
            fill: 'freeze',
          }),
        );
        packets.append(packet);
        routeIndex++;
      });
      const pulse = element('circle', {
        class: 'delivery-ping',
        cx: x,
        cy: y,
        r: '.6',
      });
      pulse.append(
        element('animate', {
          attributeName: 'r',
          values: '.6;3.4',
          dur: '2.8s',
          repeatCount: 'indefinite',
        }),
        element('animate', {
          attributeName: 'opacity',
          values: '.8;0',
          dur: '2.8s',
          repeatCount: 'indefinite',
        }),
      );
      layer.append(
        routes,
        packets,
        pulse,
        element('circle', { class: 'delivery-core', cx: x, cy: y, r: '.32' }),
      );
      container.append(layer);
      layer.pauseAnimations();
      return layer;
    }

    function pause() {
      if (!svg) return;
      svg.classList.remove('live');
      svg.pauseAnimations();
      // CSS-переходы тоже замораживаются: первый рисунок не продолжается вне экрана.
      transitions = svg
        .getAnimations({ subtree: true })
        .filter((animation) =>
          animation.effect?.target?.classList.contains('delivery-route'),
        );
      transitions.forEach((animation) => animation.pause());
    }

    function sync() {
      if (disposed) return;
      if (!desktop.matches) {
        pause();
        return;
      }
      if (!svg) svg = build();
      const allowed =
        !reduced.matches &&
        !navigator.connection?.saveData &&
        html.dataset.milanoMotion !== 'off' &&
        !html.hasAttribute('data-motion-disabled');
      if (!allowed) {
        pause();
        transitions = [];
        started = true;
        svg.classList.add('drawn', 'static');
        svg.setCurrentTime(4);
        return;
      }
      svg.classList.remove('static');
      if (!visible || document.hidden) {
        pause();
        return;
      }
      if (!started) {
        // Начальное скрытое состояние фиксируется до первого перехода.
        svg.getBoundingClientRect();
        svg.classList.add('drawn');
        started = true;
      }
      svg.classList.add('live');
      transitions.forEach((animation) => {
        if (animation.playState === 'paused') animation.play();
      });
      transitions = [];
      svg.unpauseAnimations();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        sync();
      },
      { threshold: 0.12 },
    );
    const flags = new MutationObserver(sync);
    flags.observe(html, {
      attributes: true,
      attributeFilter: ['data-milano-motion', 'data-motion-disabled'],
    });
    for (const media of [desktop, reduced])
      media.addEventListener('change', sync, { signal: controller.signal });
    navigator.connection?.addEventListener('change', sync, {
      signal: controller.signal,
    });
    document.addEventListener('visibilitychange', sync, {
      signal: controller.signal,
    });
    sync();
    observer.observe(container);
    return () => {
      disposed = true;
      observer.disconnect();
      flags.disconnect();
      controller.abort();
      pause();
      transitions.forEach((animation) => animation.cancel());
      transitions = [];
      svg?.remove();
    };
  }
  root.MilanoDeliveryMap = Object.freeze({ mount });
})(window);
