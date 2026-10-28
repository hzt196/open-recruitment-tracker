/* Python executes in a disposable worker; only the pinned runtime is downloaded. */
(function (host) {
  "use strict";
  // This maintained Python 3.13 runtime supports classic workers for file:// pages.
  const RUNTIME_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/pyodide.mjs";
  const OUTPUT_LIMIT = 65536;

  // Keep this function self-contained: its source also runs in the test worker.
  function pythonWorkerMain(runtimeURL, indexURL, outputLimit, classic) {
    self.onmessage = async ({ data }) => {
      if (data.type !== "execute") return;
      const { id, mode, code, stdin } = data;
      const send = (message) => self.postMessage({ id, ...message });
      let globals, outputSize = 0, exceeded = false, executing = false;
      const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
      const output = (stream, text) => {
        if (exceeded) return;
        const remaining = outputLimit - outputSize;
        const part = text.slice(0, remaining);
        if (part) { outputSize += part.length; send({ type: "output", stream, text: part }); }
        if (text.length > remaining) { exceeded = true; send({ type: "complete", status: "output-limit", error: "输出过长，已停止。" }); }
      };
      try {
        let loadPyodide;
        if (classic) { self.importScripts(runtimeURL); loadPyodide = self.loadPyodide; }
        else ({ loadPyodide } = await import(runtimeURL));
        const py = await loadPyodide({ indexURL, stdout() {}, stderr() {} });
        const bytes = new TextEncoder().encode(stdin.replace(/\r\n?/g, "\n"));
        let offset = 0;
        py.setStdin({ isatty: false, read(buffer) {
          const count = Math.min(buffer.length, bytes.length - offset);
          buffer.set(bytes.subarray(offset, offset + count)); offset += count; return count;
        } });
        for (const stream of ["stdout", "stderr"]) {
          py[stream === "stdout" ? "setStdout" : "setStderr"]({ isatty: false, write(buffer) {
            output(stream, decoders[stream].decode(buffer, { stream: true })); return buffer.length;
          } });
        }
        globals = py.toPy({ _source: code, _mode: mode });
        executing = true; send({ type: "state", state: "executing" });
        const started = performance.now();
        const result = JSON.parse(py.runPython(`
import builtins, json, linecache, sys, traceback
_result = {"status": "success", "error": ""}
_stdout, _stderr = sys.stdout, sys.stderr
linecache.cache["main.py"] = (len(_source), None, _source.splitlines(keepends=True), "main.py")
try:
    _compiled = compile(_source, "main.py", "exec")
except (SyntaxError, ValueError, OverflowError) as _error:
    _result = {"status": "error", "error": "".join(traceback.format_exception_only(type(_error), _error))}
else:
    if _mode == "run":
        try:
            exec(_compiled, {"__name__": "__main__", "__file__": "main.py", "__builtins__": builtins.__dict__})
        except SystemExit as _error:
            if _error.code not in (None, 0):
                _result = {"status": "error", "error": "SystemExit: " + str(_error.code) + "\\n"}
        except BaseException as _error:
            _result = {"status": "error", "error": "".join(traceback.format_exception(type(_error), _error, _error.__traceback__.tb_next))}
finally:
    _stdout.flush()
    _stderr.flush()
json.dumps(_result)
`, { globals }));
        for (const stream of ["stdout", "stderr"]) output(stream, decoders[stream].decode());
        send({ type: "complete", ...(exceeded ? { status: "output-limit", error: "输出过长，已停止。" } : result), elapsedMs: Math.round(performance.now() - started) });
      } catch (error) {
        const detail = String(error.message || error).slice(0, 500);
        send({ type: "complete", status: exceeded ? "output-limit" : executing ? "error" : "load-error", error: exceeded ? "输出过长，已停止。" : executing ? detail : `Python 环境加载失败，请检查网络后重试。\n原因：${detail}` });
      } finally { globals?.destroy(); }
    };
  }

  function workerSource(runtimeURL = RUNTIME_URL, indexURL = runtimeURL.slice(0, runtimeURL.lastIndexOf("/") + 1), classic = false) {
    return `(${pythonWorkerMain.toString()})(${JSON.stringify(runtimeURL)}, ${JSON.stringify(indexURL)}, ${OUTPUT_LIMIT}, ${classic});`;
  }
  function browserWorker() {
    // Module worker entry scripts can be rejected for opaque file origins.
    // Classic workers use the supported importScripts API and keep the file origin's saved data.
    const classic = host.location?.protocol === "file:";
    const runtimeURL = classic ? RUNTIME_URL.replace(/\.mjs$/, ".js") : RUNTIME_URL;
    const source = workerSource(runtimeURL, undefined, classic);
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
      return { worker: new Worker(url, { type: classic ? "classic" : "module", name: "tracker-python" }), dispose: () => URL.revokeObjectURL(url) };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }
  function create({ onEvent = () => {}, workerFactory = browserWorker, timeoutMs = 10000, loadTimeoutMs = 90000 } = {}) {
    let current = null, serial = 0;
    const finish = (task, result) => {
      if (current !== task) return;
      current = null; clearTimeout(task.timer);
      task.worker?.terminate(); task.dispose?.();
      onEvent({ type: "complete", mode: task.mode, ...result }); task.resolve(result);
    };
    return {
      execute({ mode, code, stdin = "" }) {
        if (current) return Promise.resolve({ status: "busy" });
        if (!["run", "compile"].includes(mode) || typeof code !== "string" || typeof stdin !== "string") {
          return Promise.resolve({ status: "error", error: "执行参数无效" });
        }
        return new Promise((resolve) => {
          const task = { id: ++serial, mode, resolve, size: 0 }; current = task;
          onEvent({ type: "state", state: "loading", mode });
          task.timer = setTimeout(() => finish(task, { status: "load-error", error: "Python 环境加载超时，请检查网络后重试。" }), loadTimeoutMs);
          try {
            const handle = workerFactory(); task.worker = handle.worker || handle; task.dispose = handle.dispose;
            task.worker.onmessage = ({ data }) => {
              if (current !== task || data.id !== task.id) return;
              if (data.type === "state" && data.state === "executing") {
                clearTimeout(task.timer);
                task.timer = setTimeout(() => finish(task, { status: "timeout", error: `执行超过 ${timeoutMs / 1000} 秒，已停止。` }), timeoutMs);
                onEvent({ type: "state", state: "executing", mode });
              } else if (data.type === "output" && typeof data.text === "string") {
                const text = data.text.slice(0, OUTPUT_LIMIT - task.size); task.size += text.length;
                if (text) onEvent({ type: "output", text, stream: data.stream });
                if (text.length !== data.text.length) finish(task, { status: "output-limit", error: "输出过长，已停止。" });
              } else if (data.type === "complete") finish(task, data);
            };
            task.worker.onerror = (event) => {
              event.preventDefault?.();
              const detail = event.message ? `\n原因：${String(event.message).slice(0, 500)}` : "";
              const help = host.location?.protocol === "file:" ? "\n若浏览器仍限制本地文件，请先导出all备份，再通过本地服务器打开。" : "";
              finish(task, { status: "load-error", error: `Python 环境无法启动，请检查网络或浏览器限制后重试。${detail}${help}` });
            };
            task.worker.postMessage({ type: "execute", id: task.id, mode, code, stdin });
          } catch (error) {
            finish(task, { status: "load-error", error: `Python 环境无法启动，请检查浏览器是否支持 Worker。\n原因：${String(error.message || error).slice(0, 500)}` });
          }
        });
      },
      stop() { if (current) finish(current, { status: "stopped", error: "已停止" }); },
      get busy() { return current !== null; }
    };
  }
  host.TrackerPythonRunner = { create, workerSource, RUNTIME_URL };
})(typeof window === "undefined" ? globalThis : window);
