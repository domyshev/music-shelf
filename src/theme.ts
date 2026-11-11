import { createTheme } from '@mui/material/styles';
export function makeTheme(mode: 'light' | 'dark') {
  const dark = mode === 'dark';
  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: { main: dark ? '#e7e7e7' : '#242424', contrastText: dark ? '#171717' : '#ffffff' },
      secondary: { main: dark ? '#bdbdbd' : '#555555' },
      background: { default: dark ? '#141414' : '#f3f3f3', paper: dark ? '#202020' : '#ffffff' },
      text: { primary: dark ? '#f1f1f1' : '#1d1d1d', secondary: dark ? '#b5b5b5' : '#626262' },
      divider: dark ? '#444444' : '#dddddd',
      success: { main: dark ? '#d0d0d0' : '#444444' },
      warning: { main: dark ? '#cccccc' : '#555555' },
      error: { main: dark ? '#e0e0e0' : '#333333' },
      info: { main: dark ? '#c8c8c8' : '#555555' },
    },
    typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 12, button: { textTransform: 'none' } },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: { defaultProps: { disableElevation: true, size: 'small' } },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiTableCell: { styleOverrides: { root: { fontSize: 12, padding: '7px 12px', borderColor: dark ? '#343434' : '#e7e7e7' }, head: { background: dark ? '#292929' : '#f2f2f2', fontWeight: 600, color: dark ? '#c4c4c4' : '#555555', fontSize: 11 } } },
      MuiTooltip: {
        defaultProps: { enterDelay: 450, arrow: true, placement: 'right' },
        styleOverrides: { tooltip: { backgroundColor: dark ? '#303030' : '#ffffff', color: dark ? '#f1f1f1' : '#1d1d1d', boxShadow: '0 3px 16px #0002', border: `1px solid ${dark ? '#5a5a5a' : '#d9d9d9'}`, fontSize: 12, maxWidth: 380 }, arrow: { color: dark ? '#303030' : '#ffffff' } },
      },
    },
  });
}
