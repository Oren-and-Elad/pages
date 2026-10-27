// The simulator has no live transcription: the real stt.js opens a connection to a speech service, and nothing in this
// folder may send anything anywhere. This stub keeps the console's 📝 button harmless.
export function initStt() {
  const say = () => alert('בסימולציה אין תמלול חי. נסו לחיצה ארוכה על +.');
  return { isActive: () => false, binding: () => null, mount() {}, startNew: say, startIn: say };
}
