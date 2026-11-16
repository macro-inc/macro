{
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
  lib,
}:
buildNpmPackage {
  pname = "swagger2openapi";
  version = "7.0.8";
  src = ./swagger2openapi;
  nodejs = nodejs_24;
  npmDepsHash = "sha256-qBtNwqQIURAO94TlbrKjxREKOBVw0gE+mRvarmSgAjc=";
  npmFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/swagger2openapi" "$out/bin"
    cp -r node_modules "$out/lib/swagger2openapi/"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/swagger2openapi" \
      --add-flags "$out/lib/swagger2openapi/node_modules/swagger2openapi/swagger2openapi.js"
    runHook postInstall
  '';

  meta = {
    description = "Convert Swagger 2 API descriptions to OpenAPI 3";
    license = lib.licenses.bsd3;
    mainProgram = "swagger2openapi";
  };
}
