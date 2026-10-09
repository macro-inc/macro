#!/usr/bin/env python3
"""Publish a built image in Ohio. Explicit operator action; never run by Pulumi."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('image_directory', type=Path)
parser.add_argument('bucket', help='Existing private Ohio image-artifact bucket')
parser.add_argument('--role', default='vmimport', help='Existing VM Import service role')
args = parser.parse_args()

def aws(*arguments):
    result = subprocess.run(
        ['aws', '--region', 'us-east-2', '--output', 'json', *arguments],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else {}

identity = aws('sts', 'get-caller-identity')
if identity['Account'] != '569036502058':
    raise SystemExit('Use the Macro AWS account (569036502058)')
if aws('s3api', 'get-bucket-location', '--bucket', args.bucket)['LocationConstraint'] != 'us-east-2':
    raise SystemExit('Image bucket must be in Ohio')
public_access = aws('s3api', 'get-public-access-block', '--bucket', args.bucket)['PublicAccessBlockConfiguration']
if not all(public_access.get(key) for key in [
    'BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets',
]):
    raise SystemExit('Image bucket must have all S3 public-access blocks enabled')
info = json.loads((args.image_directory / 'nix-support/image-info.json').read_text())
if info['system'] != 'x86_64-linux' or info['boot_mode'] != 'uefi':
    raise SystemExit('Expected an x86_64 UEFI image from this flake')
image = args.image_directory / Path(info['file']).name
if image.suffix != '.vhd':
    raise SystemExit('Expected the VHD image format')
with image.open('rb') as source:
    digest = hashlib.file_digest(source, 'sha256').hexdigest()
key = f'observability/{digest}.vhd'
subprocess.run(['aws', '--region', 'us-east-2', 's3', 'cp', str(image),
                f's3://{args.bucket}/{key}', '--sse', 'AES256'], check=True)
task = aws('ec2', 'import-snapshot', '--role-name', args.role, '--encrypted',
           '--description', f'Macro observability {digest}',
           '--disk-container', json.dumps({
               'Format': 'VHD', 'UserBucket': {'S3Bucket': args.bucket, 'S3Key': key},
           }))['ImportTaskId']
print(f'Import task: {task}; artifact: s3://{args.bucket}/{key}', flush=True)
deadline = time.monotonic() + 3600
while time.monotonic() < deadline:
    detail = aws('ec2', 'describe-import-snapshot-tasks',
                 '--import-task-ids', task)['ImportSnapshotTasks'][0]['SnapshotTaskDetail']
    if detail['Status'] == 'completed':
        snapshot = detail['SnapshotId']
        break
    if detail['Status'] not in ['active', 'pending']:
        raise SystemExit(f'Import failed: {detail}')
    time.sleep(20)
else:
    raise SystemExit(f'Import still pending: inspect {task} before retrying publication')
print(f'Imported snapshot: {snapshot}', flush=True)
ami = aws('ec2', 'register-image', '--name', f'macro-observability-{digest[:20]}',
          '--architecture', 'x86_64', '--virtualization-type', 'hvm',
          '--boot-mode', 'uefi', '--ena-support', '--imds-support', 'v2.0',
          '--root-device-name', '/dev/xvda',
          '--block-device-mappings', json.dumps([{
              'DeviceName': '/dev/xvda',
              'Ebs': {'SnapshotId': snapshot, 'VolumeType': 'gp3',
                      'VolumeSize': 30, 'DeleteOnTermination': True},
          }]))['ImageId']
print(f'AMI: {ami}; SHA256: {digest}', flush=True)
aws('ec2', 'create-tags', '--resources', ami, snapshot, '--tags',
    'Key=project,Value=observability', f'Key=ImageSHA256,Value={digest}')
aws('ec2', 'wait', 'image-available', '--image-ids', ami)
print(f'Review and smoke-boot {ami}, then set Pulumi amiId. No instance was launched.')
