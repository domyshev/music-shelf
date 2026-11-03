import { useEffect, useId, useState } from 'react';
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
  const titleId = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => { if (!previewOpen || dialogOpen) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPreviewOpen(false); } }; window.addEventListener('keydown', close, true); return () => window.removeEventListener('keydown', close, true); }, [previewOpen, dialogOpen]);
  const label = kind === 'artist' ? 'Artist / band' : 'Album';
  return <>
    <Tooltip describeChild title={<EntityCard kind={kind} name={name} />} arrow placement="right" enterDelay={250} leaveDelay={150}
      open={preview && previewOpen && !dialogOpen} onOpen={() => setPreviewOpen(true)} onClose={() => setPreviewOpen(false)}
      disableHoverListener={!preview} disableFocusListener={!preview} disableTouchListener
      slotProps={{ tooltip: { sx: { p: 0, maxWidth: 'min(320px, calc(100vw - 32px))' } } }}>
      <ButtonBase className={`entity-link ${ellipsis ? 'entity-link-ellipsis' : ''}`} aria-label={`${label}: ${name}`} aria-haspopup="dialog"
        onClick={event => { event.stopPropagation(); setPreviewOpen(false); setDialogOpen(true); }}>{name}</ButtonBase>
    </Tooltip>
    {dialogOpen && <Dialog open onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs" aria-labelledby={titleId}>
      <DialogTitle sx={{ fontSize: 14, pr: 6 }}><Box component="span" sx={{position:'absolute',width:'1px',height:'1px',p:0,m:'-1px',overflow:'hidden',clip:'rect(0, 0, 0, 0)',whiteSpace:'nowrap',border:0}}>{label}: {name}</Box><span aria-hidden="true">{label}</span></DialogTitle><IconButton aria-label={`Close ${kind} card`} onClick={() => setDialogOpen(false)} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded fontSize="small" /></IconButton>
      <DialogContent><Typography sx={{ fontSize: 18, overflowWrap: 'anywhere' }}>{name}</Typography></DialogContent>
    </Dialog>}
  </>;
}
