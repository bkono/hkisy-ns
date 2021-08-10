#!/usr/bin/env bash

npm install
bindir="$(dirname $(realpath $0))/bin"
mkdir -p $bindir
pushd $bindir

tag=""
downloadCmd=""
os=$(uname -s)

if [ -x "$(command -v curl)" ]; then
  echo "curl present, using it for retrieving hkisy"
  tag=$(curl --silent "https://api.github.com/repos/bkono/hkisy/releases/latest" | grep '"tag_name":' | cut -d'"' -f4)
  downloadCmd="curl -L -o"
elif [ -x "$(command -v wget)" ]; then
  echo "wget present, using it for retrieving hkisy"
  tag=$(wget -q -O - https://api.github.com/repos/bkono/hkisy/releases/latest | grep '"tag_name":' | cut -d'"' -f4)
  downloadCmd="wget -O"
fi

release="https://github.com/bkono/hkisy/releases/download/$tag/hkisy-$tag-$os-amd64.tar.gz"
tarball="hkisy.tar.gz"

echo "downloading release: $release"
eval "$downloadCmd $tarball $release"
tar xvfz $tarball
rm $tarball
popd
