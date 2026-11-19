undef $/; $_ = <STDIN>;
s{(        owner: queueOwner,\n)(        forward: enqueueForward,)}{$1        leaseOwnerLiveness: webLockLeaseOwnerLiveness(),\n$2} or die 1;
s{(        const now = Date.now\(\);\n        const claim = \{\n          owner: queueOwner,)}{        // The enqueue may claim the head for this runner.\n        const registration = mutationQueue.ownerRegistration();\n        if (registration) await registration;\n$1} or die 2;
print;
