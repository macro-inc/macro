//
//  ViewController.swift
//  App
//
//  Created by SeihakRithy Muth on 4/10/25.
//

import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        webView?.allowsBackForwardNavigationGestures = true
    }
}
