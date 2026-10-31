import { Dialog, DialogContent, DialogTitle, IconButton, Typography, Box, Tooltip } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import AlbumOutlined from '@mui/icons-material/AlbumOutlined';
import { Status } from './Status';
import type { Track } from '../../shared/catalog';
import { formatSize } from '../format';

export function TrackDetails({ track, onClose }: { track?: Track; onClose: () => void }) {
  const file = track?.file;
  return <Dialog open={Boolean(track)} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle sx={{ pr: 6, pb: 1, fontSize: 18, display: 'flex', alignItems: 'center', gap: 1.5 }}><Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{track?.title}</Box><Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
        {track?.status === 'pending' ? <Tooltip title="This file has not been downloaded yet. File details will appear when it is ready." arrow><span tabIndex={0} aria-label="File not downloaded yet" style={{ display: 'inline-flex' }}><Status value="pending" /></span></Tooltip> : track && <Status value="ready" />}
      </Box><IconButton aria-label="Close details" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded fontSize="small" /></IconButton></DialogTitle>
    <DialogContent>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <GroupsOutlined sx={{ fontSize: 17, color: 'text.secondary', flexShrink: 0 }} />
          <Typography aria-label={`Artist: ${track?.artist ?? ''}`} sx={{ fontSize: 16, overflowWrap: 'anywhere' }}>{track?.artist}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <AlbumOutlined sx={{ fontSize: 17, color: 'text.secondary', flexShrink: 0 }} />
          <Typography aria-label={`Album: ${track?.album || 'Album unknown'}`} color="text.secondary" sx={{ fontSize: 16, overflowWrap: 'anywhere' }}>{track?.album || 'Album unknown'}</Typography>
        </Box>
      </Box>
      {file && <Box component="dl" className="file-details">{[
        ['File', file.name], ['Format / codec', `${file.format.toUpperCase()} / ${file.codec}`], ['Quality', `${file.bitDepth || '—'} bits · ${file.sampleRate.toLocaleString('en-GB')} Hz · ${file.channels} channels`], ['Size', `${formatSize(file.sizeBytes)} · ${file.sizeBytes.toLocaleString('en-GB')} bytes`], ['Duration', `${Math.floor(file.durationSeconds / 60)}:${String(Math.floor(file.durationSeconds % 60)).padStart(2, '0')}`], ['Bitrate', `${Math.round(file.bitrateBps / 1000)} kbps`], ['SHA-256', file.sha256],
      ].map(([label, value]) => <Box key={label}><Typography component="dt" color="text.secondary" sx={{ fontSize: 12, opacity: 0.7 }}>{label}</Typography><Typography component="dd" sx={{ fontSize: 14, m: 0, overflowWrap: 'anywhere', fontFamily: label === 'SHA-256' ? 'monospace' : 'inherit' }}>{value}</Typography></Box>)}</Box>}
    </DialogContent>
  </Dialog>;
}
