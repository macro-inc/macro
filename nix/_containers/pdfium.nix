# Pdfium shared library layout expected by search-processing-service.
#
# The binary dlopens `./pdfium-lib/linux/libpdfium.so` relative to `/app`.
{ pkgs }:
pkgs.runCommand "search-processing-pdfium" { } ''
  mkdir -p $out/app/pdfium-lib/linux
  cp ${../../services/search_processing_service/pdfium-lib/linux/libpdfium.so} \
    $out/app/pdfium-lib/linux/libpdfium.so
''
