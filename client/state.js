(function (root) {
  'use strict';
  let generation = 0;
  root.MilanoViewState = {
    advance: () => ++generation,
    capture: () => generation,
    current: (value) => value === generation,
  };
})(window);
