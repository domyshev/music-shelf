import { useState } from 'react';
import { Box, ButtonBase, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';

type EntityKind = 'artist' | 'album';

function EntityCard({ kind, name }: { kind: EntityKind; name: string }) {
  return <Box className="entity-card" sx={{ p: 2, minWidth: 180, maxWidth: 320 }}>
    <Typography color="text.secondary" sx={{ fontSize: 11, mb: 0.5 }}>{kind === 'artist' ? 'Artist / band' : 'Album'}</Typography>
    <Typography sx={{ fontSize: 16, fontWeight: 500, overflowWrap: 'anywhere' }}>{name}</Typography>
  </Box>;
}

/** Share the same entity card between hover previews and keyboard/click dialogs. */
export function EntityLink({ kind, name, preview = false, ellipsis = false }: { kind: EntityKind; name: string; preview?: boolean; ellipsis?: boolean }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const label = kind === 'artist' ? 'Artist / band' : 'Album';
  return <>
    <Tooltip title={<EntityCard kind={kind} name={name} />} arrow placement="right" enterDelay={250} leaveDelay={150}
      open={preview && previewOpen && !dialogOpen} onOpen={() => setPreviewOpen(true)} onClose={() => setPreviewOpen(false)}
      disableHoverListener={!preview} disableFocusListener={!preview} disableTouchListener
      slotProps={{ tooltip: { sx: { p: 0, maxWidth: 'min(320px, calc(100vw - 32px))' } } }}>
      <ButtonBase className={`entity-link ${ellipsis ? 'entity-link-ellipsis' : ''}`} aria-label={`${label}: ${name}`} aria-haspopup="dialog"
        onClick={event => { event.stopPropagation(); setPreviewOpen(false); setDialogOpen(true); }}>{name}</ButtonBase>
    </Tooltip>
    {dialogOpen && <Dialog open onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs" aria-label={`${label}: ${name}`}>
      <DialogTitle sx={{ fontSize: 14, pr: 6 }}>{label}<IconButton aria-label={`Close ${kind} card`} onClick={() => setDialogOpen(false)} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded fontSize="small" /></IconButton></DialogTitle>
      <DialogContent><Typography sx={{ fontSize: 18, overflowWrap: 'anywhere' }}>{name}</Typography></DialogContent>
    </Dialog>}
  </>;
}
