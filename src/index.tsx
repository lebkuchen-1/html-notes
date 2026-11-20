import { render } from 'solid-js/web';
import App from './App';
import './styles.css';

// Clean up cache-busting ?reload=... query parameter after an in-app PWA reload
if (typeof window !== 'undefined' && window.location.search.includes('reload=')) {
  try {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('reload');
    window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  } catch {
    // ignore
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root not found');
}

render(() => <App />, root);
