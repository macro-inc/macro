#!/bin/sh

SOURCE_DIR=$1
DEST_DIR=$2

rm -rf ./$DEST_DIR/src/jobTypes
cp -r ./$SOURCE_DIR/src/jobTypes ./$DEST_DIR/src
