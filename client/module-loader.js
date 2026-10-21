(function (root) {
  'use strict';
  const definitions = {
    account: {
      files: ['account-ui.js?v=20261020-manual-receipts1'],
      export: 'MilanoAccount',
    },
    admin: {
      files: [
        'admin-tools.js?v=20261016-repairs-final',
        'draw-ui.js?v=20261016-repairs-final',
        'admin-campaign-ui.js?v=20261020-manual-receipts1',
        'admin-ui.js?v=20261020-perf2',
        'cms-ui.js?v=20261020-perf2',
        'client/admin.js?v=20261020-perf2',
      ],
      export: 'MilanoAdmin',
    },
    legacy: {
      files: ['client/admin/legacy-import.js?v=20261020-perf2'],
      export: 'MilanoLegacyImport',
    },
  };
  const pending = new Map();
  const completed = new Set();
  function script(file, timeoutMs) {
    if (completed.has(file)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const node = document.createElement('script');
      const finish = (error) => {
        clearTimeout(timer);
        node.onload = node.onerror = null;
        if (error) {
          node.remove();
          reject(error);
        } else {
          completed.add(file);
          resolve();
        }
      };
      const timer = setTimeout(
        () => finish(new Error('module_load_timeout')),
        timeoutMs,
      );
      node.src = file;
      node.onload = () => finish();
      node.onerror = () => finish(new Error('module_load_failed'));
      document.head.append(node);
    });
  }
  function loadModule(key) {
    if (!Object.hasOwn(definitions, key))
      return Promise.reject(new Error('unknown_module'));
    if (pending.has(key)) return pending.get(key);
    const definition = definitions[key];
    // Последовательность сохраняет зависимости существующих глобальных адаптеров.
    const promise = (async () => {
      const deadline = Date.now() + 15000;
      for (const file of definition.files) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('module_load_timeout');
        await script(file, remaining);
      }
      if (!root[definition.export]) throw new Error('module_export_missing');
      return root[definition.export];
    })().catch((error) => {
      pending.delete(key);
      throw error;
    });
    pending.set(key, promise);
    return promise;
  }
  root.MilanoModules = { loadModule };
})(window);
