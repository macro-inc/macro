import unittest

import check_parity as p


def deployment(replicas=1, cpu="25m", image="a:1", env="x"):
    return {
        "kind": "Deployment",
        "spec": {
            "replicas": replicas,
            "template": {
                "spec": {
                    "containers": [
                        {
                            "image": image,
                            "env": [{"name": "E", "value": env}],
                            "resources": {"requests": {"cpu": cpu}},
                        }
                    ]
                }
            },
        },
    }


def volume(size):
    return {
        "kind": "PersistentVolumeClaim",
        "spec": {"accessModes": ["ReadWriteOnce"], "resources": {"requests": {"storage": size}}},
    }


class Parity(unittest.TestCase):
    def test_size_differences_are_allowed(self):
        self.assertEqual(
            p.compare(
                {"d": deployment(1, "25m"), "v": volume("1Gi")},
                {"d": deployment(3, "2"), "v": volume("500Gi")},
            ),
            [],
        )

    def test_a_different_image_is_not(self):
        found = p.compare({"d": deployment(image="a:1")}, {"d": deployment(image="a:2")})
        self.assertEqual(len(found), 1)
        self.assertIn("image", found[0])

    def test_a_different_environment_is_not(self):
        self.assertTrue(p.compare({"d": deployment(env="x")}, {"d": deployment(env="y")}))

    def test_a_resource_on_one_side_is_not(self):
        self.assertEqual(
            p.compare({"d": deployment(), "extra": volume("1Gi")}, {"d": deployment()}),
            ["extra: exists on only one side"],
        )

    def test_a_field_on_one_side_is_not(self):
        left, right = deployment(), deployment()
        right["spec"]["paused"] = True
        self.assertTrue(p.compare({"d": left}, {"d": right}))

    def test_replicas_outside_a_deployment_are_not_size(self):
        job = {"kind": "Other", "spec": {"replicas": 1}}
        changed = {"kind": "Other", "spec": {"replicas": 2}}
        self.assertTrue(p.compare({"o": job}, {"o": changed}))


if __name__ == "__main__":
    unittest.main()
