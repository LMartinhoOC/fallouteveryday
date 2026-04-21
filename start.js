// Inicia o scheduler; sobe o painel também se ele estiver presente localmente.
require('./src/scheduler');
try { require('./panel/server'); } catch { /* painel é local-only, opcional */ }
