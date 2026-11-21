# gp3 volumes through the EBS CSI add-on (installed by the AWS layer), the
# default class. WaitForFirstConsumer creates a volume in the zone its pod is
# scheduled to, which matters with one node per zone.
{
  applications.storage = {
    namespace = "kube-system";

    resources.storageClasses.gp3 = {
      metadata.annotations."storageclass.kubernetes.io/is-default-class" = "true";
      provisioner = "ebs.csi.aws.com";
      volumeBindingMode = "WaitForFirstConsumer";
      allowVolumeExpansion = true;
      reclaimPolicy = "Delete";
      parameters = {
        type = "gp3";
        encrypted = "true";
        "csi.storage.k8s.io/fstype" = "ext4";
      };
    };
  };
}
