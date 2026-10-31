import { Chip } from '@mui/material';
import type { Track } from '../../shared/catalog';

export function Status({ value }: { value: Track['status'] }) {
  return <Chip label={value} size="small" variant="outlined" className={`status-chip ${value}`} sx={theme => ({ '--ready-status-color': theme.palette.mode === 'dark' ? '#8abb99' : '#35734f' })} />;
}
