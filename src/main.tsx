import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { store, useAppSelector } from './store';
import { makeTheme } from './theme';
import App from './App';
import './style.css';
function ThemedApp() {
  const choice = useAppSelector(state => state.ui.theme);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = choice === 'system' ? systemDark ? 'dark' : 'light' : choice;
  const theme = useMemo(() => makeTheme(mode), [mode]);
  useEffect(() => { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.palette.background.default); }, [theme]);
  return <ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Provider store={store}><ThemedApp /></Provider></StrictMode>);
