import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';

// When the app is served from a sub-path (e.g. GitHub Pages at /web-check/),
// react-router needs that prefix so its routes and <Link>s resolve correctly.
// BASE_URL is '/' for root deployments, so this is a no-op there.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default () => (
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>
);
