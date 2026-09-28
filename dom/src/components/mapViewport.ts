export interface MapViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function visibleBottomOverlayHeight(viewportHeight: number): number {
  if (typeof document === 'undefined') return 0;

  const selectors = [
    '.tum-ride-live-sheet',
    '.tum-ride-options',
    '.tum-home-sheet',
  ];

  let covered = 0;

  selectors.forEach((selector) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0 || rect.bottom <= 0 || rect.top >= viewportHeight) return;

      // Os painéis do TUM são bottom-sheets. Usar a distância até a base da
      // viewport é mais seguro do que somente rect.height quando há safe-area.
      covered = Math.max(covered, Math.max(0, viewportHeight - Math.max(0, rect.top)));
    });
  });

  return covered;
}

/**
 * Reserva a área realmente visível do mapa acima dos bottom-sheets.
 * Isso evita que origem, destino ou o carro do motorista fiquem escondidos
 * atrás dos painéis e permite que o zoom feche naturalmente à medida que os
 * pontos se aproximam.
 */
export function mapViewportPadding(
  container: HTMLElement | null | undefined,
  activeRide = false,
): MapViewportPadding {
  const viewportHeight = Math.max(
    1,
    container?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1,
  );
  const viewportWidth = Math.max(
    1,
    container?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1,
  );

  const overlayHeight = visibleBottomOverlayHeight(viewportHeight);
  const breathingRoom = Math.max(20, Math.round(viewportHeight * 0.025));
  const minimumBottom = activeRide
    ? Math.max(250, Math.round(viewportHeight * 0.26))
    : Math.max(190, Math.round(viewportHeight * 0.19));
  const maximumBottom = Math.max(minimumBottom, Math.round(viewportHeight * 0.72));
  const bottom = Math.min(
    maximumBottom,
    Math.max(minimumBottom, Math.ceil(overlayHeight + breathingRoom)),
  );

  const horizontal = Math.max(28, Math.min(60, Math.round(viewportWidth * 0.075)));
  const top = Math.max(76, Math.min(104, Math.round(viewportHeight * 0.075)));

  return {
    top,
    right: horizontal,
    bottom,
    left: horizontal,
  };
}
