package worker

import (
	"errors"
	"io"
	"io/fs"
	"macro.com/whatsapp-session/internal/protocol"
	"time"
)

// boundedFile enforces the ceiling during upstream media transfer/decryption,
// before allocation, including when a remote Content-Length is false.
type boundedFile struct {
	data   []byte
	offset int64
}

func (f *boundedFile) Read(p []byte) (int, error) {
	n, e := f.ReadAt(p, f.offset)
	f.offset += int64(n)
	return n, e
}
func (f *boundedFile) ReadAt(p []byte, offset int64) (int, error) {
	if offset < 0 {
		return 0, protocol.ErrInvalid
	}
	if offset >= int64(len(f.data)) {
		return 0, io.EOF
	}
	n := copy(p, f.data[offset:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}
func (f *boundedFile) Write(p []byte) (int, error) {
	n, e := f.WriteAt(p, f.offset)
	f.offset += int64(n)
	return n, e
}
func (f *boundedFile) WriteAt(p []byte, offset int64) (int, error) {
	end := offset + int64(len(p))
	if offset < 0 || end < offset || end > protocol.MaxMediaBytes+1024 {
		return 0, errors.New("media_too_large")
	}
	if end > int64(len(f.data)) {
		f.data = append(f.data, make([]byte, int(end)-len(f.data))...)
	}
	copy(f.data[offset:], p)
	return len(p), nil
}
func (f *boundedFile) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekCurrent:
		offset += f.offset
	case io.SeekEnd:
		offset += int64(len(f.data))
	case io.SeekStart:
	default:
		return 0, protocol.ErrInvalid
	}
	if offset < 0 || offset > protocol.MaxMediaBytes+1024 {
		return 0, protocol.ErrInvalid
	}
	f.offset = offset
	return offset, nil
}
func (f *boundedFile) Truncate(n int64) error {
	if n < 0 || n > int64(len(f.data)) {
		return protocol.ErrInvalid
	}
	clear(f.data[n:])
	f.data = f.data[:n]
	return nil
}
func (f *boundedFile) Stat() (fs.FileInfo, error) { return fileInfo{int64(len(f.data))}, nil }

type fileInfo struct{ size int64 }

func (fileInfo) Name() string       { return "private-media" }
func (f fileInfo) Size() int64      { return f.size }
func (fileInfo) Mode() fs.FileMode  { return 0600 }
func (fileInfo) ModTime() time.Time { return time.Time{} }
func (fileInfo) IsDir() bool        { return false }
func (fileInfo) Sys() any           { return nil }
