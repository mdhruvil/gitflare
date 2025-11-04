/**
 * Contains a custom FS adapter for isomorphic-git using dofs (Durable Object File System).
 * @see https://isomorphic-git.org/docs/en/fs
 * @see https://github.com/benallfree/dofs/
 */

import type { Stats as NodeStats } from "node:fs";
import type { Fs } from "dofs";

/**
 * Normalizes a given path, resolving '..' and '.' segments and ensuring a leading slash.
 * @param p - The path to normalize.
 * @returns The normalized path.
 */
function normalizePath(p: string): string {
  let path = p;
  if (!path) return "/";
  // Strip query/hash (shouldn't appear, but be safe)
  path = path.split("?")[0].split("#")[0];
  // Replace backslashes and ensure leading slash so we treat all as absolute inside DO
  path = path.replace(/\\/g, "/");
  if (!path.startsWith("/")) path = `/${path}`;
  // Split and resolve '.' and '..'
  const out: string[] = [];
  for (const rawSeg of path.split("/")) {
    const seg = rawSeg.trim();
    if (!seg || seg === ".") continue; // skip empty & current dir
    if (seg === "..") {
      if (out.length) out.pop();
      continue;
    }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

/**
 * Custom Error class that includes a `code` property, similar to Node.js system errors.
 */
class ErrorWithCode extends Error {
  code?: string;
  path?: string;
  syscall?: string;
  constructor(message: string, code?: string, path?: string, syscall?: string) {
    super(message);
    this.code = code;
    this.path = path;
    this.syscall = syscall;
  }
}

/**
 * A file system abstraction layer that wraps a dofs (Durable Object File System) instance
 * to provide a Node.js-like `fs.promises` API, suitable for use with isomorphic-git.
 */
export class IsoGitFs {
  private readonly dofs: Fs;
  private readonly KNOWN_CODES = new Set([
    "ENOENT",
    "ENOTDIR",
    "EISDIR",
    "EEXIST",
    "EPERM",
    "EACCES",
    "EINVAL",
    "EBUSY",
    "ENOSPC",
    "ENOTEMPTY",
  ]);

  /**
   * Creates an instance of IsoGitFs.
   * @param dofs - The dofs Fs instance to wrap.
   */
  constructor(dofs: Fs) {
    this.dofs = dofs;
  }

  /**
   * Returns an object that mimics the Node.js `fs.promises` API.
   * @returns An object with promisified file system methods.
   */
  getPromiseFsClient() {
    const fs = {
      promises: {
        readFile: this.readFile.bind(this),
        writeFile: this.writeFile.bind(this),
        unlink: this.unlink.bind(this),
        readdir: this.readdir.bind(this),
        mkdir: this.mkdir.bind(this),
        rmdir: this.rmdir.bind(this),
        stat: this.stat.bind(this),
        lstat: this.lstat.bind(this),
        readlink: this.readlink.bind(this),
        symlink: this.symlink.bind(this),
      },
    };
    return fs;
  }

  /**
   * Ensures that an error object has a `code` property, attempting to infer it from the message if missing.
   * @param error - The error object to process.
   * @returns The error object with a `code` property, or undefined if no code could be determined.
   */
  private ensureErrCode(error: Error) {
    const e = new ErrorWithCode(error.message);
    if (e.code) return e;
    const msg = e.message.trim();
    if (this.KNOWN_CODES.has(msg)) {
      e.code = msg;
      return e;
    }
    const parts = msg.split(":").join(" ").split(" ");
    for (const part of parts) {
      if (this.KNOWN_CODES.has(part)) {
        e.code = part;
        return e;
      }
    }
  }

  /**
   * Annotates an error with syscall and path information and then throws it.
   * @param error - The original error.
   * @param syscall - The name of the system call that failed.
   * @param path - The path involved in the system call.
   * @throws The annotated error.
   */
  private annotateAndThrow(error: unknown, syscall: string, path: string) {
    if (error instanceof Error) {
      const e = this.ensureErrCode(error);
      if (!e) return;
      e.path = path;
      e.syscall = syscall;
      throw e;
    }
    throw error;
  }

  /**
   * Reads the content of a file.
   * @param path - The path to the file.
   * @param options - Encoding options.
   * @returns The content of the file as a Buffer or string.
   */
  async readFile(
    path: string,
    options: { encoding?: BufferEncoding } | BufferEncoding
  ) {
    const encoding = typeof options === "string" ? options : options?.encoding;
    const normalizedPath = normalizePath(path);
    try {
      const data = this.dofs.read(normalizedPath, { encoding });
      const dataBuff = Buffer.from(data);
      if (!encoding || (encoding as string) === "buffer") return dataBuff;
      return dataBuff.toString(encoding);
    } catch (error) {
      this.annotateAndThrow(error, "readFile", normalizedPath);
    }
  }

  /**
   * Writes data to a file.
   * @param filepath - The path to the file.
   * @param data - The data to write.
   * @param options - Encoding options.
   */
  async writeFile(
    filepath: string,
    data: string | ArrayBufferView | ArrayBuffer,
    options?: { encoding?: BufferEncoding } | BufferEncoding
  ) {
    const encoding = typeof options === "string" ? options : options?.encoding;
    let arrayLike: ArrayBuffer | string;
    if (typeof data === "string") {
      arrayLike = data;
    } else if (data instanceof ArrayBuffer) {
      arrayLike = data;
    } else {
      const view = data as ArrayBufferView;
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      arrayLike = copy.buffer;
    }
    const normalizedPath = normalizePath(filepath);
    try {
      await this.dofs.writeFile(normalizedPath, arrayLike, { encoding });
    } catch (error) {
      this.annotateAndThrow(error, "writeFile", normalizedPath);
    }
  }

  /**
   * Deletes a file.
   * @param path - The path to the file to delete.
   */
  async unlink(path: string) {
    const normalizedPath = normalizePath(path);
    try {
      this.dofs.unlink(normalizedPath);
    } catch (error) {
      this.annotateAndThrow(error, "unlink", normalizedPath);
    }
  }

  /**
   * Reads the contents of a directory.
   * @param path - The path to the directory.
   * @returns An array of the names of the files in the directory (excluding '.' and '..').
   */
  async readdir(path: string) {
    const normalizedPath = normalizePath(path);
    try {
      const names = this.dofs.listDir(normalizedPath, {});
      return names.filter((n) => n !== "." && n !== "..");
    } catch (error) {
      this.annotateAndThrow(error, "readdir", normalizedPath);
      return []; // to satisfy TS
    }
  }

  /**
   * Creates a directory.
   * @param path - The path to the directory to create.
   * @param options - Options for creating the directory, including `recursive` and `mode`.
   */
  async mkdir(path: string, options?: { recursive?: boolean; mode?: number }) {
    const normalizedPath = normalizePath(path);
    try {
      this.dofs.mkdir(normalizedPath, { recursive: true, ...options });
    } catch (error) {
      this.annotateAndThrow(error, "mkdir", normalizedPath);
    }
  }

  /**
   * Removes a directory.
   * @param path - The path to the directory to remove.
   * @param options - Options for removing the directory, including `recursive`.
   */
  async rmdir(path: string, options?: { recursive?: boolean }) {
    const normalizedPath = normalizePath(path);
    try {
      this.dofs.rmdir(normalizedPath, { recursive: true, ...options });
    } catch (error) {
      this.annotateAndThrow(error, "rmdir", normalizedPath);
    }
  }

  /**
   * Core stat function used by both `stat` and `lstat`.
   * @param path - The path to the file or directory.
   * @param detectSymlink - Whether to detect if the path is a symlink.
   * @returns A Node.js-like `Stats` object.
   */
  statCore(path: string, detectSymlink: boolean) {
    let isSymlink = false;
    const normalizedPath = normalizePath(path);
    if (detectSymlink) {
      try {
        this.dofs.readlink(normalizedPath);
        isSymlink = true;
      } catch (error) {
        if (error instanceof Error && error.message === "ENOENT") {
          isSymlink = false;
        } else {
          this.annotateAndThrow(error, "lstat", normalizedPath);
        }
      }
    }

    try {
      const stat = this.dofs.stat(normalizedPath);
      const atime = stat.atime ? new Date(stat.atime) : new Date(0);
      const mtime = stat.mtime ? new Date(stat.mtime) : new Date(0);
      const ctime = stat.ctime ? new Date(stat.ctime) : new Date(0);
      const birthtime = stat.crtime ? new Date(stat.crtime) : new Date(0);

      const nodeStat: NodeStats = {
        isFile: () => stat.isFile,
        isDirectory: () => stat.isDirectory,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => isSymlink,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 0,
        ino: 0,
        mode: stat.mode ?? 0,
        nlink: stat.nlink ?? 1,
        uid: stat.uid ?? 0,
        gid: stat.gid ?? 0,
        rdev: stat.rdev ?? 0,
        size: stat.size ?? 0,
        blksize: stat.blksize ?? 4096,
        blocks: stat.blocks ?? 0,
        atimeMs: atime.getTime(),
        mtimeMs: mtime.getTime(),
        ctimeMs: ctime.getTime(),
        birthtimeMs: birthtime.getTime(),
        atime,
        mtime,
        ctime,
        birthtime,
      };

      return nodeStat;
    } catch (error) {
      this.annotateAndThrow(
        error,
        detectSymlink ? "lstat" : "stat",
        normalizedPath
      );
    }
  }

  /**
   * Returns information about a file or directory. If the path is a symbolic link, then the link itself is stat-ed, not the file that it refers to.
   * @param path - The path to the file or directory.
   * @returns A Node.js-like `Stats` object.
   */
  async stat(path: string) {
    return this.statCore(path, false);
  }

  /**
   * Returns information about a file or directory. If the path is a symbolic link, then the link itself is stat-ed, not the file that it refers to.
   * @param path - The path to the file or directory.
   * @returns A Node.js-like `Stats` object.
   */
  async lstat(path: string) {
    return this.statCore(path, true);
  }

  /**
   * Reads the value of a symbolic link.
   * @param path - The path to the symbolic link.
   * @returns The path to which the symbolic link points.
   */
  async readlink(path: string) {
    try {
      return this.dofs.readlink(path);
    } catch (error) {
      this.annotateAndThrow(error, "readlink", path);
    }
  }

  /**
   * Creates a symbolic link.
   * @param target - The target path of the link.
   * @param path - The path where the symbolic link will be created.
   */
  async symlink(target: string, path: string) {
    try {
      return this.dofs.symlink(target, path);
    } catch (error) {
      this.annotateAndThrow(error, "symlink", path);
    }
  }
}
