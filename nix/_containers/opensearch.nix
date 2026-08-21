# analysis-icu for the local OpenSearch container.
#
# The stock `opensearchproject/opensearch:3.5.0` image does not ship this
# plugin. The old Dockerfile ran `opensearch-plugin install` at image build;
# doing that at container start tries to download from
# artifacts.opensearch.org, which is often unreachable from inside Compose.
# Fetch the zip as a fixed-output derivation and unpack it so Arion can
# bind-mount the plugin directory into the official image.
{ pkgs }:
let
  zip = pkgs.fetchurl {
    url = "https://artifacts.opensearch.org/releases/plugins/analysis-icu/3.5.0/analysis-icu-3.5.0.zip";
    hash = "sha256-ZUCg1WsXWcCJ4CRkhFZkeuigLRAcSC9w7Qul88mXMO4=";
  };
in
{
  inherit zip;

  plugin = pkgs.runCommand "opensearch-analysis-icu-3.5.0" {
    nativeBuildInputs = [ pkgs.unzip ];
    inherit zip;
  } ''
    mkdir -p "$out"
    unzip -q "$zip" -d "$out"
  '';
}
