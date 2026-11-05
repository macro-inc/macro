// noVNC 1.7 exports the package root; upstream types still name lib/rfb.
declare module '@novnc/novnc' {
  import RFB from '@novnc/novnc/lib/rfb';
  export default RFB;
}
