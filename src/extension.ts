import * as vscode from 'vscode';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import * as fs from 'fs';

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyArPIHjZcAENtW0L5hbgKgJw2X50yBbZ70",
  authDomain: "fenado-plugin.firebaseapp.com",
  projectId: "fenado-plugin",
  storageBucket: "fenado-plugin.firebasestorage.app",
  messagingSenderId: "176629130510",
  appId: "1:176629130510:web:90b041439915fbfc96e35f",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let currentUser: User | null = null;

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Extension Activated');

  // Create and initialize the output channel
  outputChannel = vscode.window.createOutputChannel('Fenado Plugin');
  outputChannel.appendLine('Fenado Plugin initialized.');
  outputChannel.show();

  // Check for signed-in user and open stored projects
  try {
    if (auth.currentUser) {
      currentUser = auth.currentUser;
      vscode.window.showInformationMessage(`Welcome back, ${currentUser.email}! Opening your projects...`);
      outputChannel.appendLine(`User signed in: ${currentUser.email}`);
      await openStoredProjects();
    } else {
      vscode.window.showInformationMessage('Please sign in to access your projects.');
    }
  } catch (error) {
    handleError(error);
  }

  // Register the Sign In Command
  const disposableSignIn = vscode.commands.registerCommand('plugin-fenado.signIn', async () => {
    const email = await vscode.window.showInputBox({ prompt: 'Enter your email' });
    const password = await vscode.window.showInputBox({ prompt: 'Enter your password', password: true });

    if (!email || !password) {
      vscode.window.showErrorMessage('Email and password are required.');
      return;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      currentUser = userCredential.user;
      vscode.window.showInformationMessage(`Welcome, ${currentUser.email}! You are now signed in.`);
      outputChannel.clear(); // Clear output after a successful sign-in
      outputChannel.appendLine(`User signed in: ${currentUser.email}`);
      await openStoredProjects();

      // Refresh tree view to hide the sign-in prompt
      vscode.commands.executeCommand('fenado-signUp.refresh');
    } catch (error) {
      handleError(error);
    }
  });

  // Register the Logout Command
  const disposableLogout = vscode.commands.registerCommand('plugin-fenado.logout', async () => {
    try {
      await signOut(auth);
      currentUser = null;
      vscode.window.showInformationMessage('You have been logged out successfully.');
      outputChannel.clear(); // Clear output after logout
      outputChannel.appendLine('User logged out.');

      // Refresh tree view to show the sign-in prompt again
      vscode.commands.executeCommand('fenado-signUp.refresh');
    } catch (error) {
      handleError(error);
    }
  });

  // Register the Tree View for the Activity Bar
  const signUpProvider = new SignUpViewProvider(context);
  vscode.window.registerTreeDataProvider('fenado-signUp', signUpProvider);

  // Push Commands into Subscriptions
  context.subscriptions.push(
    disposableSignIn,
    disposableLogout,
    disposableSaveProject,
    disposableUpdateProject,
    disposableDeleteProject,
    disposableListProjects,
    vscode.commands.registerCommand('fenado-signUp.triggerSignIn', () => {
      vscode.commands.executeCommand('plugin-fenado.signIn');
    }),
    vscode.commands.registerCommand('fenado-signUp.refresh', () => {
      signUpProvider.refresh();
    })
  );
}

// TreeView Data Provider for "Sign Up" Button
class SignUpViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<void | null> = new vscode.EventEmitter<void | null>();
  readonly onDidChangeTreeData: vscode.Event<void | null> = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) { }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!currentUser) {
      // Display message and "Sign In" button
      return [
        new vscode.TreeItem('You are not yet signed in. Please sign in.', vscode.TreeItemCollapsibleState.None),
        new SignUpTreeItem('Sign In', vscode.TreeItemCollapsibleState.None, {
          command: 'fenado-signUp.triggerSignIn',
          title: 'Sign In',
        }),
      ];
    }
    return []; // No items if the user is signed in
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }
}

// TreeItem for Sign Up Button
class SignUpTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.command = command;
    this.iconPath = new vscode.ThemeIcon('account'); // Blue "account" icon
  }
}

// // Function to Open Stored Projects
// async function openStoredProjects() {
//   try {
//     if (!currentUser) {
//       vscode.window.showErrorMessage('You need to sign in to access your projects.');
//       return;
//     }

//     const projectsQuery = query(collection(db, 'projects'), where('uid', '==', currentUser.uid));
//     const projectsSnapshot = await getDocs(projectsQuery);

//     if (projectsSnapshot.empty) {
//       vscode.window.showInformationMessage('No projects found.');
//       return;
//     }

//     for (const doc of projectsSnapshot.docs) {
//       const project = doc.data();
//       if (project.files && project.files.length > 0) {
//         for (const filePath of project.files) {
//           const uri = vscode.Uri.file(filePath);
//           await vscode.workspace.openTextDocument(uri).then(doc => {
//             vscode.window.showTextDocument(doc, { preview: false });
//           });
//         }
//       }
//     }
//   } catch (error) {
//     handleError(error);
//   }
// }

// Save Project Command
let disposableSaveProject = vscode.commands.registerCommand('plugin-fenado.saveProject', async () => {
  if (!currentUser) {
    vscode.window.showErrorMessage('You need to sign in first!');
    return;
  }

  const openFiles = vscode.workspace.textDocuments.map(doc => doc.fileName);
  const projectName = await vscode.window.showInputBox({ prompt: 'Enter project name' });

  if (!projectName) {
    vscode.window.showErrorMessage('Project name is required.');
    return;
  }

  try {
    const projectData = {
      name: projectName,
      files: openFiles
    };
    const projectRef = doc(db, 'projects', projectName);
    await setDoc(projectRef, projectData);
    vscode.window.showInformationMessage('Project saved successfully!');
    outputChannel.appendLine('Project saved: ' + projectName);
    outputChannel.show();
  } catch (error) {
    handleError(error);
  }
});

// Update Project Command
let disposableUpdateProject = vscode.commands.registerCommand('plugin-fenado.updateProject', async () => {
  if (!currentUser) {
    vscode.window.showErrorMessage('You need to sign in first!');
    return;
  }

  const projectName = await vscode.window.showInputBox({ prompt: 'Enter project name to update' });
  if (!projectName) {
    vscode.window.showErrorMessage('Project name is required.');
    return;
  }

  const openFiles = vscode.workspace.textDocuments.map(doc => doc.fileName);

  try {
    const projectData = {
      name: projectName,
      files: openFiles
    };
    const projectRef = doc(db, 'projects', projectName);
    await setDoc(projectRef, projectData, { merge: true });
    vscode.window.showInformationMessage('Project updated successfully!');
    outputChannel.appendLine('Project updated: ' + projectName);
    outputChannel.show();
  } catch (error) {
    handleError(error);
  }
});

// Delete Project Command
let disposableDeleteProject = vscode.commands.registerCommand('plugin-fenado.deleteProject', async () => {
  if (!currentUser) {
    vscode.window.showErrorMessage('You need to sign in first!');
    return;
  }

  const projectName = await vscode.window.showInputBox({ prompt: 'Enter the project name to delete' });

  if (projectName) {
    try {
      await deleteDoc(doc(db, 'projects', projectName));
      vscode.window.showInformationMessage('Project deleted successfully!');
      outputChannel.appendLine('Project deleted: ' + projectName);
      outputChannel.show();
    } catch (error) {
      handleError(error);
    }
  }
});

// List Projects Command
let disposableListProjects = vscode.commands.registerCommand('plugin-fenado.listProjects', async () => {
  if (!currentUser) {
    vscode.window.showErrorMessage('You need to sign in first!');
    return;
  }

  try {
    const projectsQuery = query(collection(db, 'projects'), where('uid', '==', currentUser.uid));
    const projectsSnapshot = await getDocs(projectsQuery);
    const projectNames = projectsSnapshot.docs.map(doc => doc.data().name);

    if (projectNames.length === 0) {
      vscode.window.showInformationMessage('No projects found.');
      return;
    }

    const selectedProjectName = await vscode.window.showQuickPick(projectNames, { placeHolder: 'Select a project to open' });

    if (selectedProjectName) {
      const selectedProject = projectsSnapshot.docs.find(doc => doc.data().name === selectedProjectName);
      const projectFiles = selectedProject?.data().files || [];

      for (const filePath of projectFiles) {
        if (fs.existsSync(filePath)) {
          try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
          } catch (err) {
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
            console.error(`Error opening file ${filePath}:`, err);
          }
        } else {
          vscode.window.showErrorMessage(`File does not exist: ${filePath}`);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage('Failed to fetch projects: ' + error.message);
    } else {
      vscode.window.showErrorMessage('An unknown error occurred while fetching projects.');
    }
  }
});

async function openStoredProjects() {
  try {
    if (!currentUser) {
      vscode.window.showErrorMessage('You need to sign in to access your projects.');
      return;
    }

    const projectsQuery = query(collection(db, 'projects'), where('uid', '==', currentUser.uid));
    const projectsSnapshot = await getDocs(projectsQuery);

    if (projectsSnapshot.empty) {
      vscode.window.showInformationMessage('No projects found.');
      return;
    }

    for (const doc of projectsSnapshot.docs) {
      const project = doc.data();
      if (project.files && project.files.length > 0) {
        for (const filePath of project.files) {
          const uri = vscode.Uri.file(filePath);
          await vscode.workspace.openTextDocument(uri).then(doc => {
            vscode.window.showTextDocument(doc, { preview: false });
          });
        }
      }
    }
  } catch (error) {
    handleError(error);
  }
}


// Error Handling
function handleError(error: unknown) {
  if (error instanceof Error) {
    vscode.window.showErrorMessage('Error: ' + error);
    outputChannel.appendLine('Error: ' + error);
  } else {
    vscode.window.showErrorMessage('An unexpected error occurred.');
    outputChannel.appendLine('An unexpected error occurred.');
  }
  outputChannel.show();
}

export function deactivate() {
  console.log('Extension Deactivated');
}
