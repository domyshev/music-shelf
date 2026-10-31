import { createTheme } from '@mui/material/styles';
export function makeTheme(mode: 'light' | 'dark') {
  const dark = mode === 'dark';
  return createTheme({
    cssVariables: true,
    palette: { mode, primary: { main: dark ? '#a4c38e' : '#43694e' }, background: { default: dark ? '#171c18' : '#f5f7f3', paper: dark ? '#202720' : '#ffffff' }, text: { primary: dark ? '#e2e9df' : '#28362c', secondary: dark ? '#a1ad9e' : '#7a857b' }, divider: dark ? '#374035' : '#e5eae1', success: { main: dark ? '#a3c98c' : '#567c4e' }, warning: { main: dark ? '#d5ba78' : '#9d7c38' } },
    typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 12, button: { textTransform: 'none' } },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: { defaultProps: { disableElevation: true, size: 'small' } },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiTableCell: { styleOverrides: { root: { fontSize: 12, padding: '7px 12px', borderColor: dark ? '#30392e' : '#edf0e9' }, head: { background: dark ? '#252e24' : '#f8faf6', fontWeight: 600, color: dark ? '#acb8a5' : '#788471', fontSize: 11 } } },
      MuiTooltip: {
        defaultProps: { enterDelay: 450, arrow: true, placement: 'right' },
        styleOverrides: { tooltip: { backgroundColor: dark ? '#30382f' : '#ffffff', color: dark ? '#edf2ea' : '#28362c', boxShadow: '0 3px 16px #0002', border: `1px solid ${dark ? '#46513f' : '#e0e7da'}`, fontSize: 12, maxWidth: 380 }, arrow: { color: dark ? '#30382f' : '#ffffff' } },
      },
    },
  });
}
