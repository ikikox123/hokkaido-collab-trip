import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SharePage } from './components/SharePage';
import { I18nProvider } from './i18n/I18nProvider';
import { isSharePath } from './lib/sharePath';
import './index.css';

function Root() {
  const [share, setShare] = useState(() => isSharePath(window.location.pathname));
  useEffect(() => {
    const sync = () => setShare(isSharePath(window.location.pathname));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return share ? <SharePage /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Root />
    </I18nProvider>
  </StrictMode>,
);
