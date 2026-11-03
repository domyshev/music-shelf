import { createTheme } from '@mui/material/styles';
export function makeTheme(mode: 'light' | 'dark') {
  const dark = mode === 'dark';
  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: { main: dark ? '#8db7ff' : '#275db1' },
      secondary: { main: dark ? '#ff8090' : '#ba354b' },
      background: { default: dark ? '#101726' : '#f3f6fc', paper: dark ? '#192337' : '#ffffff' },
      text: { primary: dark ? '#edf2fc' : '#192844', secondary: dark ? '#acbad0' : '#586b87' },
      divider: dark ? '#34445f' : '#dce4f1',
      success: { main: dark ? '#91bbff' : '#275fae' },
      warning: { main: dark ? '#ff9aa7' : '#a63247' },
      error: { main: dark ? '#ff8493' : '#b82f46' },
    },
    typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 12, button: { textTransform: 'none' } },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: { defaultProps: { disableElevation: true, size: 'small' } },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiTableCell: { styleOverrides: { root: { fontSize: 12, padding: '7px 12px', borderColor: dark ? '#293a55' : '#e8edf6' }, head: { background: dark ? '#202d44' : '#f0f4fb', fontWeight: 600, color: dark ? '#bac8de' : '#526786', fontSize: 11 } } },
      MuiTooltip: {
        defaultProps: { enterDelay: 450, arrow: true, placement: 'right' },
        styleOverrides: { tooltip: { backgroundColor: dark ? '#26344a' : '#ffffff', color: dark ? '#edf2fc' : '#192844', boxShadow: '0 3px 16px #0002', border: `1px solid ${dark ? '#465a79' : '#d9e3f2'}`, fontSize: 12, maxWidth: 380 }, arrow: { color: dark ? '#26344a' : '#ffffff' } },
      },
    },
  });
}
