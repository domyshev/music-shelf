import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { TranslationPreference } from './TranslationPreference';
import { UploadKeySettings } from './UploadKeySettings';
export function AppSettings({open,onClose}:{open:boolean;onClose:()=>void}) {
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs"><DialogTitle>Settings</DialogTitle><DialogContent><TranslationPreference open={open}/><UploadKeySettings open={open}/></DialogContent><DialogActions><Button onClick={onClose}>Close</Button></DialogActions></Dialog>;
}
