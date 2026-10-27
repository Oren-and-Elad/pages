// The simulator never talks to a server: every request that is not a file in this folder is refused before it leaves.
(function () {
  var here = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  var local = function (u) { try { return new URL(String(u && u.url || u), location.href).href.indexOf(here) === 0; } catch (e) { return false; } };
  var f = window.fetch;
  window.fetch = function (u, o) { return local(u) ? f.call(window, u, o) : Promise.reject(new Error('offline simulation')); };
  window.WebSocket = function () { throw new Error('offline simulation'); };
  window.EventSource = function () { throw new Error('offline simulation'); };
  if (navigator.sendBeacon) navigator.sendBeacon = function () { return false; };
})();
